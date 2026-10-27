import type { EventingCommandSender } from "@langwatch/eventing";
import type {
  VkLifecycleAction,
  RecordBudgetCrossingCommandData,
  RecordVkLifecycleCommandData,
} from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant, type Instant } from "@langwatch/time";

const logger = createLogger("langwatch:gateway:governance-events");

type GovernanceSender = Pick<EventingCommandSender<unknown>, "send">;
type GovernanceSenders = Readonly<{
  recordBudgetCrossing?: GovernanceSender;
  recordVkLifecycle?: GovernanceSender;
}>;

/**
 * Records gateway's governance facts; the senders arrive when the pipeline connects.
 * A crossing that cannot be recorded throws, so its debit is re-driven; a lifecycle
 * fact is best effort, as main's was: a key mutation never fails on it.
 */
export class GatewayGovernanceEventsService implements GatewayGovernanceSignals {
  #senders: GovernanceSenders = {};

  private constructor(
    private readonly projects: Pick<ProjectApi, "listIdsByOrganization">,
    private readonly clock: () => Instant,
  ) {}

  static create({
    projects,
    clock = nowInstant,
  }: {
    projects: Pick<ProjectApi, "listIdsByOrganization">;
    clock?: () => Instant;
  }): GatewayGovernanceEventsService {
    return new GatewayGovernanceEventsService(projects, clock);
  }

  connect(commands: Readonly<Record<string, GovernanceSender>>): void {
    this.#senders = {
      recordBudgetCrossing: commands.recordBudgetCrossing,
      recordVkLifecycle: commands.recordVkLifecycle,
    };
  }

  async recordBudgetCrossing(data: RecordBudgetCrossingCommandData): Promise<void> {
    const sender = this.#senders.recordBudgetCrossing;
    if (!sender) throw new Error("governance_events_processing is not registered in this process");
    await sender.send(data);
  }

  async emitVirtualKeyLifecycle(signal: GatewayVirtualKeyLifecycleSignal): Promise<void> {
    const { virtualKey, action } = signal;
    try {
      const sender = this.#senders.recordVkLifecycle;
      if (!sender) return;
      const tenantId = await this.tenantOf(virtualKey);
      if (!tenantId) return;
      const data: RecordVkLifecycleCommandData = {
        tenantId,
        organization_id: virtualKey.organizationId,
        virtual_key_id: virtualKey.id,
        action,
        name: virtualKey.name,
        display_prefix: virtualKey.displayPrefix,
        reason: signal.reason ?? null,
        occurred_at: this.clock().epochMilliseconds,
      };
      await sender.send(data);
    } catch (error) {
      logger.warn(
        { virtualKeyId: virtualKey.id, action, error },
        "failed to record a virtual key lifecycle fact (best effort)",
      );
    }
  }

  /** The key's trace project, else one stable organization project for event tenancy. */
  private async tenantOf(
    virtualKey: GatewayVirtualKeyLifecycleSignal["virtualKey"],
  ): Promise<string | null> {
    if (virtualKey.traceProjectId) return virtualKey.traceProjectId;
    const ids = await this.projects.listIdsByOrganization({
      organizationId: virtualKey.organizationId,
    });
    return ids.toSorted()[0] ?? null;
  }
}

/**
 * The Enterprise governance ledger's view of a virtual key's life. A port
 * rather than a direct call: governance is an Enterprise capability, and a
 * core package may not reach one directly. Absent when no ledger is composed.
 */
export type GatewayVirtualKeyLifecycleSignal = {
  virtualKey: {
    id: string;
    organizationId: string;
    name: string;
    displayPrefix: string;
    traceProjectId: string | null;
  };
  action: VkLifecycleAction;
  reason?: string | null;
};

export interface GatewayGovernanceSignals {
  emitVirtualKeyLifecycle(signal: GatewayVirtualKeyLifecycleSignal): Promise<void>;
}
