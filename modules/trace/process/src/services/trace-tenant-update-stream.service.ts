import type { TracesTrpcEmitters } from "#app/trace.app";

type TraceTenantUpdateEvent = "trace_updated" | "discover_updated" | "export_progress";

/** A tenant's pushes off presence's fan-out (as scenario's simulation-update stream reads them). */
export class TraceTenantUpdateStreamService {
  static create({ emitters }: { emitters: TracesTrpcEmitters }): TraceTenantUpdateStreamService {
    return new TraceTenantUpdateStreamService(emitters);
  }

  private constructor(private readonly emitters: TracesTrpcEmitters) {}

  /** Each push's envelope until `signal` aborts or the caller stops; releases the emitter. */
  async *watch({
    projectId,
    eventName,
    signal,
  }: {
    projectId: string;
    eventName: TraceTenantUpdateEvent;
    signal?: AbortSignal | undefined;
  }): AsyncGenerator<unknown> {
    const emitter = this.emitters.getTenantEmitter(projectId);
    const queued: unknown[] = [];
    let wake: (() => void) | null = null;
    const onEvent = (...args: unknown[]) => {
      queued.push(args[0]);
      wake?.();
    };
    const onAbort = () => wake?.();
    emitter.on(eventName, onEvent);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      while (!signal?.aborted) {
        if (queued.length > 0) {
          yield queued.shift();
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    } finally {
      emitter.off(eventName, onEvent);
      signal?.removeEventListener("abort", onAbort);
      this.emitters.cleanupTenantEmitter(projectId);
    }
  }
}
