import { AsyncResource } from 'async_hooks';
import { Promise as BasePromise } from '.';

// Need encapsulation since we're compiling to ES5 (to avoid conflicting
// Promise definition).
class PromiseAsyncResource implements AsyncResource {
  private asyncResource: AsyncResource;

  constructor(promise: BasePromise<any>, parent?: Promise<any>) {
    this.asyncResource = new AsyncResource(
      'K-PROMISE',
      parent ? parent['asyncResource'].asyncId() : undefined
    );
    (this.asyncResource as any).parent = parent;
    (this.asyncResource as any).promise = promise;
  }

  emitBefore(): void {
    return this.asyncResource.emitBefore();
  }

  emitAfter(): void {
    return this.asyncResource.emitAfter();
  }

  emitDestroy(): void {
    return this.asyncResource.emitDestroy();
  }

  asyncId(): number {
    return this.asyncResource.asyncId();
  }

  triggerAsyncId(): number {
    return this.asyncResource.triggerAsyncId();
  }
}

/**
 * An attempt at adding opinionated async_hooks support for this Promise
 * implementation.
 */
export class Promise<T> extends BasePromise<T> {
  private asyncResource: AsyncResource;

  constructor(
    fn: (resolve: (value: T) => void, reject: (err: Error) => void) => void
  ) {
    super(fn);
    this.asyncResource = new PromiseAsyncResource(this);
  }

  then<S>(
    onResolve?: (value: T) => S|BasePromise<S>,
    onReject?: (err: Error) => S|BasePromise<S>
  ): BasePromise<S|T> {
    const result = super.then(
      onResolve && ((value: T) => {
        this.asyncResource.emitBefore();
        const result = onResolve(value);
        this.asyncResource.emitAfter();
        this.asyncResource.emitDestroy();
        return result;
      }),
      onReject && ((err: Error) => {
        this.asyncResource.emitBefore();
        const result = onReject(err);
        this.asyncResource.emitAfter();
        this.asyncResource.emitDestroy();
        return result;
      })
    );
    (result as any).asyncResource = new PromiseAsyncResource(result, this);
    (result as any).then = Promise.prototype.then;
    return result;
  }
}
