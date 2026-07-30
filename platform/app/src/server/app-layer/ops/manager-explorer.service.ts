import type { ProcessStore, Registry } from "@langwatch/event-sourcing";

/** The aggregate's current position in one manager's machine. */
export interface AggregateProcessManagerInstance {
  /**
   * The persisted state JSON. Deliberately identities-and-flags only — the
   * content boundary keeps customer payload out of it — so it is safe to render
   * directly.
   */
  state: unknown;
  /** Optimistic-concurrency counter; 1 after the first commit. */
  revision: number;
  /** The stamp the row was written under; a build that cannot decode it skips the row. */
  stateVersion: string;
}

/** One process-manager state machine as it stands for a single aggregate. */
export interface AggregateProcessManager {
  processName: string;
  pipelineName: string;
  /** Event types that drive the machine's transitions. */
  eventTypes: readonly string[];
  /** Intent types the machine can emit — the commands it sends to other aggregates. */
  intentTypes: readonly string[];
  hasWake: boolean;
  /** The aggregate's current position, or null if the machine never started for it. */
  instance: AggregateProcessManagerInstance | null;
}

/**
 * Reads the process-manager state machines for a single aggregate: the machine
 * definition, read off the registry every pipeline registers into, joined to
 * this aggregate's persisted instance.
 *
 * The machine itself is implicit in `evolve` (no declared state set), so the
 * "state machine" shown is the definition surface plus the instance's current
 * position. The intents an instance emitted are not answerable here: the outbox
 * is a claim-and-settle port with no read-by-instance.
 */
export class ManagerExplorerService {
  constructor(
    private readonly store: ProcessStore,
    private readonly registry: Registry,
  ) {}

  async getForAggregate(params: {
    aggregateType: string;
    projectId: string;
    aggregateId: string;
  }): Promise<AggregateProcessManager[]> {
    const registered = this.registry
      .all()
      .find((entry) => entry.aggregateType === params.aggregateType);
    if (!registered) return [];

    return Promise.all(
      Object.values(registered.pipeline.processManagers).map(
        async (manager) => {
          const instance = await this.store.load({
            processName: manager.name,
            projectId: params.projectId,
            processKey: params.aggregateId,
          });
          return {
            processName: manager.name,
            pipelineName: registered.pipeline.name,
            eventTypes: manager.eventTypes,
            intentTypes: manager.intentTypes,
            hasWake: manager.onWake !== undefined,
            instance: instance
              ? {
                  state: instance.state,
                  revision: instance.revision,
                  stateVersion: instance.stateVersion,
                }
              : null,
          };
        },
      ),
    );
  }
}
