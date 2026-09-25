import type { PresenceApi } from "@langwatch/presence-contract";
import {
  simulationStreamFrameSchema,
  type SimulationStreamFrame,
} from "@langwatch/scenario-contract";

type TenantEmitters = Pick<PresenceApi, "getTenantEmitter" | "cleanupTenantEmitter">;

/** A project's `simulation_updated` frames, relayed from the process's tenant fan-out. */
export class SimulationUpdateStreamService {
  static create(emitters: TenantEmitters): SimulationUpdateStreamService {
    return new SimulationUpdateStreamService(emitters);
  }

  private constructor(private readonly emitters: TenantEmitters) {}

  async *watch({
    projectId,
    signal,
  }: {
    projectId: string;
    signal?: AbortSignal;
  }): AsyncGenerator<SimulationStreamFrame> {
    const emitter = this.emitters.getTenantEmitter(projectId);
    const queued: unknown[] = [];
    let wake: (() => void) | null = null;
    const onEvent = (...args: unknown[]) => {
      queued.push(args[0]);
      wake?.();
    };
    const onAbort = () => wake?.();
    emitter.on("simulation_updated", onEvent);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      while (!signal?.aborted) {
        const next = queued.shift();
        if (next === void 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = null;
          continue;
        }
        const frame = simulationStreamFrameSchema.safeParse(next);
        if (frame.success) yield frame.data;
      }
      signal?.throwIfAborted();
    } finally {
      emitter.off("simulation_updated", onEvent);
      signal?.removeEventListener("abort", onAbort);
      this.emitters.cleanupTenantEmitter(projectId);
    }
  }
}
