const promisesAplusTests = require('promises-aplus-tests');
const { Promise } = require('./ah');

promisesAplusTests({
  resolved: (value: any) => Promise.resolve(value),
  rejected: (err: Error) => Promise.reject(err),
  deferred: () => {
    const result: any = {};
    result.promise = new Promise((resolve: any, reject: any) => {
      result.resolve = resolve;
      result.reject = reject;
    });
    return result;
  }
});
