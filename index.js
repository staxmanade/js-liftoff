const util = require('util');
const path = require('path');
const EE = require('events').EventEmitter;
const extend = require('extend');
const resolve = require('resolve');
const findCwd = require('./lib/find_cwd');
const findConfig = require('./lib/find_config');
const fileSearch = require('./lib/file_search');
const parseOptions = require('./lib/parse_options');
const silentRequire = require('./lib/silent_require');
const buildConfigNameRegex = require('./lib/build_config_name_regex');

function Liftoff (opts) {
  EE.call(this);
  extend(this, parseOptions(opts));
}
util.inherits(Liftoff, EE);

Liftoff.prototype.requireLocal = function (module, basedir) {
  try {
    var result = require(resolve.sync(module, {basedir: basedir}));
    this.emit('require', module, result);
    return result;
  } catch (e) {
    this.emit('requireFail', module, e);
  }
};

Liftoff.prototype.buildEnvironment = function (opts) {
  opts = opts||{};

  // get modules we want to preload
  var require = opts.require||[];

  // make a copy of search paths that can be mutated for this run
  var searchPaths = this.searchPaths.slice();

  // calculate current cwd
  var cwd = findCwd(opts);

  // if cwd was provided explicitly, only use it
  if (opts.cwd) {
    searchPaths = [cwd];
  } else {
    // otherwise just search in cwd first
    searchPaths.unshift(cwd);
  }

  // calculate the regex to use for finding the config file
  var configNameRegex = buildConfigNameRegex({
    configName: this.configName,
    extensions: Object.keys(this.extensions)
  });

  // calculate configPath
  var configPath = findConfig({
    configNameRegex: configNameRegex,
    searchPaths: searchPaths,
    configPath: opts.configPath
  });

  // if we have a config path, save the directory it resides in.
  var configBase;
  if (configPath) {
    configBase = path.dirname(configPath);
  }

  // TODO: break this out into lib/
  // locate local module and package next to config or explicitly provided cwd
  var modulePath, modulePackage;
  try {
    modulePath = resolve.sync(this.moduleName, {basedir: configBase || cwd});
    modulePackage = silentRequire(fileSearch('package.json', [modulePath]));
  } catch (e) {}

  // if we have a configuration but we failed to find a local module, maybe
  // we are developing against ourselves?
  if (!modulePath && configPath) {
    // check the package.json sibling to our config to see if its `name`
    // matches the module we're looking for
    modulePackage = silentRequire(fileSearch('package.json', [configBase]));
    if (modulePackage && modulePackage.name === this.moduleName) {
      // if it does, our module path is `main` inside package.json
      modulePath = path.join(configBase, modulePackage.main||'index.js');
      cwd = configBase;
    } else {
      // clear if we just required a package for some other project
      modulePackage = {};
    }
  }

  // preload module needed for config if any has been specified.
  var requireForExtension = this.extensions[path.extname(configPath)];
  if (requireForExtension) {
    require.push(requireForExtension);
  }

  // preload modules, if any
  if (require.length) {
    if (!Array.isArray(require)) {
      require = [require];
    }
    require.forEach(function (dep) {
      this.requireLocal(dep, findCwd(opts));
    }, this);
  }

  return {
    cwd: cwd,
    require: require,
    configNameRegex: configNameRegex,
    configPath: configPath,
    configBase: configBase,
    modulePath: modulePath,
    modulePackage: modulePackage||{}
  };
};

Liftoff.prototype.launch = function (opts, fn) {
  if (typeof fn !== 'function') {
    throw new Error('You must provide a callback function.');
  }

  process.title = this.processTitle;

  var completion = opts.completion;
  if (completion && this.completions) {
    return this.completions(completion);
  }

  fn.call(this, this.buildEnvironment(opts));
};

module.exports = Liftoff;
