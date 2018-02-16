class TaskQueue {
  private queue: Array<() => void> = []

  private drain() {
    if (this.queue.length > 0) {
      const q2 = this.queue.map(a => a);
      this.queue.length = 0;
      q2.forEach(fn => fn());
      process.nextTick(this.drain.bind(this));
    }
  }

  push(fn: () => void): void {
    if (this.queue.length === 0) {
      process.nextTick(this.drain.bind(this));
    }
    this.queue.push(fn);
  }
}

class DeferredValue<T> {
  private static readonly DEFERRED = {};
  private onResolve: Array<(value: T) => void> = [];
  private value: T|{} = DeferredValue.DEFERRED;
  private peers: DeferredValue<any>[] = [];
  private taskQueue: TaskQueue;

  constructor(taskQueue: TaskQueue) {
    this.taskQueue = taskQueue;
  }

  push(fn: (value: T) => void) {
    if (this.checkPeers()) {
      return;
    } else if (this.value !== DeferredValue.DEFERRED) {
      this.taskQueue.push(() => fn(this.value as T));
    } else {
      this.onResolve.push(fn);
    }
  }

  resolve(value: T) {
    if (this.value !== DeferredValue.DEFERRED || this.checkPeers()) {
      return;
    }
    this.value = value;
    this.taskQueue.push(() => {
      this.onResolve.forEach(fn => fn(value));
      this.onResolve.length = 0;
    });
    this.peers.forEach(peer => peer.onResolve.length = 0);
  }

  setPeers(peers: DeferredValue<any>[]) {
    this.peers = peers;
  }

  private checkPeers() {
    return this.peers.some(peer => peer.value !== DeferredValue.DEFERRED);
  }

  static createPair<S, T>(
    taskQueue: TaskQueue
  ): [DeferredValue<S>, DeferredValue<T>] {
    const a = new DeferredValue<S>(taskQueue);
    const b = new DeferredValue<T>(taskQueue);
    a.setPeers([b]);
    b.setPeers([a]);
    return [a, b];
  }
}

export class Promise<T> {
  private static readonly taskQueue: TaskQueue = new TaskQueue();
  private static readonly UNKNOWN = {};
  private resolved: DeferredValue<T>;
  private rejected: DeferredValue<Error>;

  constructor(
    fn: (resolve: (value: T) => void,
    reject: (err: Error) => void) => void
  ) {
    const [res, rej] = DeferredValue.createPair<T, Error>(Promise.taskQueue);
    this.resolved = res;
    this.rejected = rej;
    const reject = (err: Error) => this.rejected.resolve(err);
    const resolve = (value: any) => {
      let then;
      try {
        if (
          value !== null &&
          typeof value === 'object' ||
          typeof value === 'function'
        ) {
          then = (value as any).then;
        }
        let once = false;
        const wrapOnce = (fn: Function) => (...args: any[]) => {
          if (!once) {
            once = true;
            fn(...args);
          }
        };
        if (typeof then === 'function') {
          try {
            then.call(value, wrapOnce(resolve), wrapOnce(reject));
          } catch (err) {
            wrapOnce(reject)(err);
          }
        } else {
          this.resolved.resolve(value);
        }
      } catch (err) {
        this.rejected.resolve(err);
      }
    };
    try {
      fn(resolve, reject);
    } catch (err) {
      reject(err);
    }
  }
  
  then<S>(
    onResolve?: (value: T) => S|Promise<S>,
    onReject?: (err: Error) => S|Promise<S>
  ): Promise<S|T> {
    const result = new Promise<S|T>((resolve, reject) => {
      const addResolutionHandler = <X>(
        deferredValue: DeferredValue<X>,
        cb: (value: X) => S|Promise<S>
      ) => {
        deferredValue.push(value => {
          let pending;
          try {
            pending = cb(value);
            if (pending === result) {
              reject(new TypeError());
              return;
            }
          } catch (err) {
            reject(err);
            return;
          }
          resolve(pending as S);
        });
      };
      if (typeof onResolve === 'function') {
        addResolutionHandler(this.resolved, onResolve);
      } else {
        this.resolved.push(resolve);
      }
      if (typeof onReject === 'function') {
        addResolutionHandler(this.rejected, onReject);
      } else {
        this.rejected.push(reject);
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
