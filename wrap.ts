import { AsyncResource } from 'async_hooks';

type AsyncTaskCallback<T> = (err: Error|null, output?: T) => void;
type AsyncTask<I, O> = (input: I, cb: AsyncTaskCallback<O>) => void;

/**
 * Wraps a function that represents an asynchronous task so that only a certain
 * number of instances of that task can be happening at a time. If the function
 * is invoked when the maximum number of running tasks is met, it will be queued
 * to be run later.
 * @param task The function to wrap.
 * @param numWorkers The maximum number of instances of that task that can run
 * at a time.
 */
export function wrapPool<I, O>(task: AsyncTask<I, O>, numWorkers: number): AsyncTask<I, O> {
  let numWorkersActive = 0;
  const queue: Array<() => void> = [];
  return (input: I, cb: AsyncTaskCallback<O>) => {
    const asyncResource = new AsyncResource('PooledTask');
    const execute = () => {
      asyncResource.emitBefore();
      numWorkersActive++;
      task(input, (err: Error|null, output?: O) => {
        numWorkersActive--;
        if (queue.length > 0) {
          queue.splice(0, 1)[0]();
        }
        cb(err, output);
      });
      asyncResource.emitAfter();
      asyncResource.emitDestroy();
    }
    if (numWorkersActive < numWorkers) {
      execute();
    } else {
      queue.push(execute);
    }
  };
}

/**
 * Wraps a function that represents an asynchronous task so that they will all
 * be fired once a certain number of instances of that task have been queued. If
 * the function before the specified number of running tasks is met, it will be
 * queued to be run later.
 * @param task The function to wrap.
 * @param numWorkers The number of instances of that task that should be queued
 * before all instances are run together.
 */
export function wrapBatch<I, O>(task: AsyncTask<I, O>, queueSize: number): AsyncTask<I, O> {
  const queue: Array<() => void> = [];
  return (input: I, cb: AsyncTaskCallback<O>) => {
    const asyncResource = new AsyncResource('BatchedTask');
    const execute = () => {
      asyncResource.emitBefore();
      task(input, cb);
      asyncResource.emitAfter();
      asyncResource.emitDestroy();
    }
    queue.push(execute);
    if (queue.length === queueSize) {
      queue.map(fn => fn());
      queue.length = 0;
    }
  };
}
