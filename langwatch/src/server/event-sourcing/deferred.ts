import type { QueueSendOptions } from "./queues/queue.types";

/**
 * A dispatcher function produced by `mapCommands` for a given command payload.
 *
 * Matches the signature: `(data: P, options?: QueueSendOptions<P>) => Promise<void>`
 */
export type CommandDispatcher<P> = (
  data: P,
  options?: QueueSendOptions<P>,
) => Promise<void>;

/**
 * Typed container for a function that will be provided after construction.
 *
 * Replaces the ad-hoc `let x: T | null = null` + closure + null-check pattern
 * used in PipelineRegistry for self-referencing commands, post-registration
 * jobs, and cross-pipeline dispatchers.
 *
 * @example
 * ```ts
 * const dispatch = new Deferred<CommandDispatcher<ResolveOriginCommandData>>("resolveOrigin");
 * // Pass dispatch.fn to reactor deps (before register)
 * const reactor = createReactor({ resolveOrigin: dispatch.fn });
 * // Wire after register
 * dispatch.resolve(traceCommands.resolveOrigin);
 * ```
 */
export class Deferred<Fn extends (...args: never[]) => unknown> {
  private _value: Fn | null = null;
  private readonly _name: string;

  constructor(name: string) {
    this._name = name;
  }

  /** Callable proxy — safe to pass as a dependency before resolve(). */
  readonly fn: Fn = ((...args: Parameters<Fn>): ReturnType<Fn> => {
    if (!this._value) {
      throw new Error(
        `Deferred "${this._name}" not yet resolved — pipeline registration order issue`,
      );
    }
    return this._value(...args) as ReturnType<Fn>;
  }) as Fn;

  /** Wire the real implementation. Must be called exactly once. */
  resolve(value: Fn): void {
    if (this._value) {
      throw new Error(`Deferred "${this._name}" already resolved`);
    }
    this._value = value;
  }

  get isResolved(): boolean {
    return this._value !== null;
  }
}
