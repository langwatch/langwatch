import type { PresenceApi } from "@langwatch/presence-contract";
import {
  simulationStreamFrameSchema,
  startScenarioTabPresence,
  type ScenarioTabRegistry,
  type SimulationStreamFrame,
  type SimulationUpdateWatchInput,
} from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";

type TenantEmitters = Pick<PresenceApi, "getTenantEmitter" | "cleanupTenantEmitter">;

/** A project's `simulation_updated` frames, relayed from the process's tenant fan-out. */
export class SimulationUpdateStreamService {
  static create(input: {
    emitters: TenantEmitters;
    scenarioTabs: ScenarioTabRegistry;
  }): SimulationUpdateStreamService {
    return new SimulationUpdateStreamService(input.emitters, input.scenarioTabs);
  }

  private constructor(
    private readonly emitters: TenantEmitters,
    private readonly scenarioTabs: ScenarioTabRegistry,
  ) {}

  /** One tab's stream: registered as present while it lives, its parked navigate first. */
  async *watchForTab({
    projectId,
    tabKey,
    tabId,
    signal,
  }: SimulationUpdateWatchInput): AsyncGenerator<SimulationStreamFrame> {
    const presence =
      tabKey && tabId
        ? await startScenarioTabPresence({
            registration: { projectId, tabKey, tabId },
            registry: this.scenarioTabs,
          })
        : null;

    if (presence?.parkedNavigate) {
      // The same envelope the broadcast path emits, so the client parses one shape.
      yield {
        event: JSON.stringify(presence.parkedNavigate),
        timestamp: nowInstant().epochMilliseconds,
      };
    }

    try {
      yield* this.watch({ projectId, signal });
    } catch (error) {
      // A disconnect aborts the wait, which is the normal end of a stream, not a stream error.
      if (!(error instanceof Error) || error.name !== "AbortError") throw error;
    } finally {
      await presence?.stop();
    }
  }

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
