/**
 * An interface that represents a queue of tasks that automatically gets drained
 * asynchronously.
 */
interface TaskQueue {
  /**
   * Push a function onto the task queue. Functions passed to this function
   * will be called asynchronously, in the order in which they were called.
   * @param fn The function to push onto the task queue.
   */
  push(fn: () => void): void;
}

/**
 * A `TaskQueue` that simply passes pushed functions to `process.nextTick`.
 */
class NextTickTaskQueue implements TaskQueue {
  push(fn: () => void): void {
    process.nextTick(fn);
  }
}

/**
 * A class that represents an abstraction over a single deferred value.
 */
class DeferredValue<T> {
  private static readonly DEFERRED = {}; // Sentinel value
  private onResolveQueue: Array<(value: T) => void> = [];
  private value: T|{} = DeferredValue.DEFERRED;
  private peers: DeferredValue<any>[] = [];
  private taskQueue: TaskQueue;

  /**
   * Construct a new `DeferredValue` instance.
   * @param taskQueue The task queue to which deferred value resolution
   * callbacks should be pushed.
   */
  constructor(taskQueue: TaskQueue) {
    this.taskQueue = taskQueue;
  }

  /**
   * Specify a new function that will be invoked after the deferred value has
   * been resolved. If the deferred value was already resolved, it will be
   * invoked promptly (placed into the underlying task queue with the resolved
   * value as an argument).
   * @param fn The function to invoke.
   */
  onResolve(fn: (value: T) => void) {
    if (this.checkPeers()) {
      return;
    } else if (this.value !== DeferredValue.DEFERRED) {
      this.taskQueue.push(() => fn(this.value as T));
    } else {
      this.onResolveQueue.push(fn);
    }
  }

  /**
   * Resolve the deferred value. Any functions that were previously specified
   * to run through `onResolve` will now be placed into the underlying task
   * queue (with the resolved value as an argument). After the first call,
   * subsequent calls to this function have no effect.
   * @param value The resolved value.
   */
  resolve(value: T) {
    if (this.value !== DeferredValue.DEFERRED || this.checkPeers()) {
      return;
    }
    this.value = value;
    this.taskQueue.push(() => {
      this.onResolveQueue.forEach(fn => fn(value));
      this.onResolveQueue.length = 0;
    });
    this.peers.forEach(peer => peer.onResolveQueue.length = 0);
  }

  /**
   * Set "peer" deferred values. If a peer's deferred value is resolved first,
   * the other functions on this object have no effect. This means that any
   * functions previously passed to onResolve may never be called.
   * @param peers A list of peer DeferredValue objects.
   */
  setPeers(peers: DeferredValue<any>[]) {
    this.peers = peers;
  }

  private checkPeers() {
    return this.peers.some(peer => peer.value !== DeferredValue.DEFERRED);
  }
}

/**
 * An implementation of the `Promise` specification.
 */
export class Promise<T> {
  private static readonly taskQueue: TaskQueue = new NextTickTaskQueue();
  private static readonly UNKNOWN = {};
  private resolved: DeferredValue<T>;
  private rejected: DeferredValue<Error>;

  constructor(
    fn: (resolve: (value: T) => void, reject: (err: Error) => void) => void
  ) {
    // Initialize deferred value storage.
    this.resolved = new DeferredValue<T>(Promise.taskQueue);
    this.rejected = new DeferredValue<Error>(Promise.taskQueue);
    this.resolved.setPeers([this.rejected]);
    this.rejected.setPeers([this.resolved]);
    // Intialize resolve/reject callbacks.
    const reject = (err: Error) => this.rejected.resolve(err);
    const resolve = (value: T) => {
      let then;
      try {
        // Check if the resolved value is a thenable.
        if (
          value !== null &&
          typeof value === 'object' ||
          typeof value === 'function'
        ) {
          then = (value as any).then;
        }
        if (typeof then === 'function') {
          // The resolved value is indeed a thenable. We should recursively
          // call `then` on the value until we get to one that isn't, and
          // resolve with that value.
          // Since thenables are not constrained to call a single callback,
          // enforce that constraint here by ensuring that only the first
          // call to resolve or reject succeeds.
          let once = false;
          const wrapOnce = <T>(fn: (arg: T) => void) => (arg: T) => {
            if (!once) {
              once = true;
              fn(arg);
            }
          };
          try {
            // Call `then` on the value.
            then.call(value, wrapOnce(resolve), wrapOnce(reject));
          } catch (err) {
            // Reject with a synchronously thrown error.
            wrapOnce(reject)(err);
          }
        } else {
          // The resolved value isn't a thenable, so resolve with it.
          this.resolved.resolve(value);
        }
      } catch (err) {
        // Reject with a synchronously thrown error.
        reject(err);
      }
    };
    // Call the passed function synchronously.
    try {
      fn(resolve, reject);
    } catch (err) {
      // Reject with a synchronously thrown error.
      reject(err);
    }
  }
  
  then<S>(
    onResolve?: (value: T) => S|Promise<S>,
    onReject?: (err: Error) => S|Promise<S>
  ): Promise<S|T> {
    const result = new Promise<any>((resolve, reject) => {
      // Helper function to queue a callback to run when a deferred value is
      // resolved.
      const addResolutionHandler = <X>(
        deferredValue: DeferredValue<X>,
        cb: (value: X) => S|Promise<S>
      ) => {
        // Instead of directly queueing the callback, we queue a wrapper
        // that does some extra checks and error handling.
        deferredValue.onResolve(value => {
          let pending;
          try {
            // Run the callback.
            pending = cb(value);
            if (pending === result) {
              // If an object returns itself through a `then` callback, reject
              // with a TypeError.
              reject(new TypeError());
              return;
            }
          } catch (err) {
            // Reject with a synchronously thrown error.
            reject(err);
            return;
          }
          // Resolve with the value returned by the `then` callback.
          resolve(pending);
        });
      };
      // Register the given callbacks, or "pass-through" callbacks if none
      // are provided.
      if (typeof onResolve === 'function') {
        addResolutionHandler(this.resolved, onResolve);
      } else {
        this.resolved.onResolve(resolve);
      }
      if (typeof onReject === 'function') {
        addResolutionHandler(this.rejected, onReject);
      } else {
        this.rejected.onResolve(reject);
      }
    });
    return result;
  }

  catch<S>(onReject?: (err: Error) => S|Promise<S>): Promise<S> {
    return this.then(undefined, onReject) as Promise<S>;
  }

  static all<T = any>(promises: Promise<T>[]): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const results: T[] = new Array(promises.length);
      let count = 0;
      promises.forEach((promise, index) => {
        promise.then(value => {
          results[index] = value;
          if (++count === results.length) {
            resolve(results);
          }
        }, reject);
      })
    });
  }

  static race<T = any>(promises: Promise<T>[]): Promise<T> {
    return new Promise((resolve, reject) => {
      promises.forEach(promise => promise.then(resolve, reject))
    });
  }

  static resolve<T>(value: T): Promise<T> {
    return new Promise((resolve, reject) => {
      resolve(value);
    });
  }

  static reject(err: Error): Promise<never> {
    return new Promise((resolve, reject) => {
      reject(err);
    });
  }
}
