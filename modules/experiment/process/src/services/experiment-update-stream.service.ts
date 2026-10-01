import {
  experimentUpdateFrameSchema,
  type ExperimentUpdateFrame,
} from "@langwatch/experiment-contract";
import type { PresenceApi } from "@langwatch/presence-contract";

export type ExperimentUpdateEmitters = Pick<
  PresenceApi,
  "getTenantEmitter" | "cleanupTenantEmitter"
>;

/** A project's `experiment_updated` pushes off presence's fan-out, read as trace's stream reads them. */
export class ExperimentUpdateStreamService {
  static create({
    emitters,
  }: {
    emitters: ExperimentUpdateEmitters;
  }): ExperimentUpdateStreamService {
    return new ExperimentUpdateStreamService(emitters);
  }

  private constructor(private readonly emitters: ExperimentUpdateEmitters) {}

  /** Each push's envelope until `signal` aborts or the caller stops; releases the emitter. */
  async *watch({
    projectId,
    signal,
  }: {
    projectId: string;
    signal?: AbortSignal | undefined;
  }): AsyncGenerator<ExperimentUpdateFrame> {
    const emitter = this.emitters.getTenantEmitter(projectId);
    const queued: unknown[] = [];
    let wake: (() => void) | null = null;
    const onEvent = (...args: unknown[]) => {
      queued.push(args[0]);
      wake?.();
    };
    const onAbort = () => wake?.();
    emitter.on("experiment_updated", onEvent);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      while (!signal?.aborted) {
        const next = queued.shift();
        if (next !== undefined) {
          const frame = experimentUpdateFrameSchema.safeParse(next);
          if (frame.success) yield frame.data;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    } finally {
      emitter.off("experiment_updated", onEvent);
      signal?.removeEventListener("abort", onAbort);
      this.emitters.cleanupTenantEmitter(projectId);
    }
  }
}
