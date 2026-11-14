const { compileOk } = require('./index.cjs');

module.exports = function okalitLoader(source) {
  this.cacheable?.();
  const result = compileOk(source.toString(), { filename: this.resourcePath });
  this.callback(null, result.code, result.map);
};
