import { getProcessManagerMetadata } from "~/server/event-sourcing/pipelineRegistry";
import type { ProcessRef } from "~/server/event-sourcing/process-manager/processManager.types";
import type { ProcessStore } from "~/server/event-sourcing/process-manager/stores/processStore.types";

/** The aggregate's current position in one manager's machine. */
export interface AggregateProcessManagerInstance {
  /**
   * The persisted state JSON. Deliberately identities-and-flags only — the
   * content boundary (`toPayload`) keeps customer payload out of it — so it is
   * safe to render directly.
   */
  state: unknown;
  /** Optimistic-concurrency counter; 1 after the first commit. */
  revision: number;
  /** Epoch ms of the next due wake-up, or null when none is scheduled. */
  nextWakeAt: number | null;
  updatedAt: number;
}

/** One cross-aggregate command this instance emitted, via the transactional outbox. */
export interface AggregateProcessManagerOutboxMessage {
  messageKey: string;
  intentType: string;
  status: "pending" | "dispatched" | "dead";
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  /** The event that produced this intent; null for a wake-driven commit. */
  sourceEventId: string | null;
}

/** One process-manager state machine as it stands for a single aggregate. */
export interface AggregateProcessManager {
  processName: string;
  pipelineName: string;
  /** Event types that drive the machine's transitions. */
  eventTypes: readonly string[];
  /** Intent types the machine can emit — the commands it sends to other aggregates. */
  intentTypes: string[];
  hasWake: boolean;
  /** The aggregate's current position, or null if the machine never started for it. */
  instance: AggregateProcessManagerInstance | null;
  outbox: AggregateProcessManagerOutboxMessage[];
}

/**
 * Reads the process-manager state machines for a single aggregate: the machine
 * definition (from the live pipeline introspection) joined to this aggregate's
 * persisted instance and the intents it has emitted.
 *
 * The machine itself is implicit in `evolve` (no declared state set), so the
 * "state machine" shown is the definition surface plus the instance's current
 * position — its state JSON, revision, and next wake.
 */
export class ManagerExplorerService {
  constructor(private readonly store: ProcessStore) {}

  /**
   * The per-aggregate managers for one aggregate. Scheduled singletons are
   * excluded — they are keyed by process name, not aggregate id, so "this
   * aggregate's instance" does not apply to them.
   */
  async getForAggregate(params: {
    aggregateType: string;
    projectId: string;
    aggregateId: string;
  }): Promise<AggregateProcessManager[]> {
    const managers = getProcessManagerMetadata().filter(
      (m) => m.aggregateType === params.aggregateType && !m.scheduled,
    );

    return Promise.all(
      managers.map(async (m) => {
        const ref: ProcessRef = {
          processName: m.processName,
          projectId: params.projectId,
          processKey: params.aggregateId,
        };
        const [instance, messages] = await Promise.all([
          this.store.findByRef({ ref }),
          this.store.findMessagesByRef({ ref }),
        ]);
        return {
          processName: m.processName,
          pipelineName: m.pipelineName,
          eventTypes: m.eventTypes,
          intentTypes: m.intentTypes,
          hasWake: m.hasWake,
          instance: instance
            ? {
                state: instance.state,
                revision: instance.revision,
                nextWakeAt: instance.nextWakeAt,
                updatedAt: instance.updatedAt,
              }
            : null,
          outbox: messages.map((msg) => ({
            messageKey: msg.messageKey,
            intentType: msg.intentType,
            status: msg.status,
            attempts: msg.attempts,
            nextAttemptAt: msg.nextAttemptAt,
            createdAt: msg.createdAt,
            sourceEventId: msg.sourceEventId,
          })),
        };
      }),
    );
  }
}
