const fs = require('fs');
const { pbjs, pbts } = require('protobufjs-cli');
const protobuf = require('protobufjs');
const tmp = require('tmp');
const validateOptions = require('schema-utils').validate;

const TARGET_STATIC_MODULE = 'static-module';

/** @type { Parameters<typeof validateOptions>[0] } */
const schema = {
  type: 'object',
  properties: {
    target: {
      type: 'string',
      default: TARGET_STATIC_MODULE,
    },
    paths: {
      type: 'array',
    },
    pbjsArgs: {
      type: 'array',
      default: [],
    },
    pbts: {
      oneOf: [
        {
          type: 'boolean',
        },
        {
          type: 'object',
          properties: {
            args: {
              type: 'array',
              default: [],
            },
            output: {
              anyOf: [{ type: 'null' }, { instanceof: 'Function' }],
              default: null,
            },
          },
          additionalProperties: false,
        },
      ],
      default: false,
    },
  },

  additionalProperties: false,
};

/**
 * Shared type for the validated options object, with no missing
 * properties (i.e. the user-provided object merged with default
 * values).
 *
 * @typedef {{ args: string[], output: ((resourcePath: string) => string | Promise<string>) | null }} PbtsOptions
 * @typedef {{
 *   paths: string[], pbjsArgs: string[],
 *   pbts: boolean | PbtsOptions,
 *   target: string,
 * }} LoaderOptions
 */

/**
 * The generic parameter is the type of the options object in the
 * configuration. All `LoaderOptions` fields are optional at this
 * stage.
 *
 * @typedef { import('webpack').LoaderContext<Partial<LoaderOptions>> } LoaderContext
 */

/** @type { (resourcePath: string, pbtsOptions: true | PbtsOptions, compiledContent: string | undefined) => Promise<void> } */
const execPbts = async (resourcePath, pbtsOptions, compiledContent) => {
  /** @type PbtsOptions */
  const normalizedOptions = {
    args: [],
    output: null,
    ...(pbtsOptions === true ? {} : pbtsOptions),
  };

  /**
   * Immediately run the function to get the typescript output path. If
   * the function is asynchronous, it will run in the background while
   * we kick off other async operations.
   *
   * @type { (resourcePath: string) => string | Promise<string> }
   */
  const output =
    normalizedOptions.output === null
      ? (r) => `${r}.d.ts`
      : normalizedOptions.output;
  const declarationFilenamePromise = Promise.resolve(output(resourcePath));

  // pbts CLI only supports streaming from stdin without a lot of
  // duplicated logic, so we need to use a tmp file. :(
  const compiledFilename = await new Promise((resolve, reject) => {
    tmp.file({ postfix: '.js' }, (err, compiledFilename) => {
      if (err) {
        reject(err);
      } else {
        resolve(compiledFilename);
      }
    });
  });

  // Write the compiled JS content to the tmp file.
  await new Promise((resolve, reject) => {
    fs.writeFile(compiledFilename, compiledContent || '', (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(compiledFilename);
      }
    });
  });

  const declarationFilename = await declarationFilenamePromise;
  const pbtsArgs = ['-o', declarationFilename]
    .concat(normalizedOptions.args)
    .concat([compiledFilename]);

  /** @type { Promise<void> } */
  const pbtsPromise = new Promise((resolve, reject) => {
    pbts.main(pbtsArgs, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
  await pbtsPromise;
};

/**
 * Main loader invocation. Return the pbjs-transformed content of a
 * protobuf source, and write typescript declarations if appropriate.
 *
 * @type { (source: string, context: LoaderContext) => Promise<string | undefined> }
 */
const loadSource = async (source, context) => {
  const defaultPaths = (() => {
    if (context._compiler) {
      // The `_compiler` property is deprecated, but still works as
      // of webpack@5.
      return (context._compiler.options.resolve || {}).modules;
    }

    return undefined;
  })();

  /** @type LoaderOptions */
  const options = {
    target: TARGET_STATIC_MODULE,
    // Default to the module search paths given to the compiler.
    paths: defaultPaths || [],
    pbjsArgs: [],
    pbts: false,
    ...context.getOptions(),
  };
  validateOptions(schema, options, { name: 'protobufjs-loader' });

  /**
   * Get a tmp file location and write the file content.
   *
   * @type { string }
   */
  const filename = await new Promise((resolve, reject) => {
    tmp.file((err, filename) => {
      if (err) {
        reject(err);
      } else {
        resolve(filename);
      }
    });
  });

  await new Promise((resolve, reject) => {
    fs.writeFile(filename, source, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(filename);
      }
    });
  });

  const { paths } = options;

  /**
   * Adapted from the import resolution setup in
   * https://github.com/dcodeIO/protobuf.js/blob/master/cli/pbjs.js.
   *
   * In addition to the main pbjs invocation, run a manual compilation
   * pass which resolves imports using the provided include paths, and
   * mark all visited imports as dependencies of the current resource.
   *
   * @type { Promise<protobuf.Root> }
   */
  const loadDependencies = new Promise((resolve, reject) => {
    const root = new protobuf.Root();

    // Set up the resolver which will mark dependencies as it goes.
    root.resolvePath = (origin, target) => {
      const normOrigin = protobuf.util.path.normalize(origin);
      const normTarget = protobuf.util.path.normalize(target);

      let resolved = protobuf.util.path.resolve(normOrigin, normTarget, true);
      const idx = resolved.lastIndexOf('google/protobuf/');
      if (idx > -1) {
        const altname = resolved.substring(idx);
        if (altname in protobuf.common) {
          resolved = altname;
        }
      }

      if (fs.existsSync(resolved)) {
        // Don't add a dependency on the temp file
        if (resolved !== protobuf.util.path.normalize(filename)) {
          context.addDependency(resolved);
        }
        return resolved;
      }

      for (let i = 0; i < paths.length; i += 1) {
        const iresolved = protobuf.util.path.resolve(`${paths[i]}/`, target);
        if (fs.existsSync(iresolved)) {
          context.addDependency(iresolved);
          return iresolved;
        }
      }

      return null;
    };

    // Perform the actual parsing/dependency resolution, and resolve
    // when finished, i.e. after all dependencies have been visited
    // and marked.
    protobuf.load(filename, root, (err, result) => {
      if (err || result === undefined) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });

  /** @type { string[] } */
  let args = ['-t', options.target];
  paths.forEach((path) => {
    args = args.concat(['-p', path]);
  });
  args = args.concat(options.pbjsArgs).concat([filename]);

  /**
   * Run the pbjs compiler and get the compiled content.
   *
   * @type { string | undefined }
   */
  const compiledContent = await new Promise((resolve, reject) => {
    pbjs.main(args, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });

  // If appropriate, run the pbts compiler.
  if (options.pbts) {
    await execPbts(context.resourcePath, options.pbts, compiledContent);
  }

  // Ensure all dependencies are marked before returning a value.
  await loadDependencies;

  return compiledContent;
};

/** @type { (this: LoaderContext, source: string) => void } */
module.exports = function (source) {
  const callback = this.async();

  // Explicitly check this case, as the typescript compiler thinks
  // it's possible.
  if (callback === undefined) {
    throw new Error('Failed to request async execution from webpack');
  }

  loadSource(source, this)
    .then((compiled) => {
      callback(undefined, compiled);
    })
    .catch((err) => {
      callback(err, undefined);
    });
};
