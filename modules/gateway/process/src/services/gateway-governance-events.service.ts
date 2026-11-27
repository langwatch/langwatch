import type { EventingCommandSender } from "@langwatch/eventing";
import type {
  VkLifecycleAction,
  RecordBudgetCrossingCommandData,
  RecordUnbudgetedSpendCommandData,
  RecordVkFirstRequestCommandData,
  RecordVkLifecycleCommandData,
  VirtualKeyPurpose,
} from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import { toPersonActorId } from "../rules/gateway-governance-actor.rules.ts";

const logger = createLogger("langwatch:gateway:governance-events");

type GovernanceSender = Pick<EventingCommandSender<unknown>, "send">;
type GovernanceSenders = Readonly<{
  recordBudgetCrossing?: GovernanceSender;
  recordVkLifecycle?: GovernanceSender;
  recordVkFirstRequest?: GovernanceSender;
  recordUnbudgetedSpend?: GovernanceSender;
}>;

/**
 * Records gateway's governance facts; the senders arrive when the pipeline connects. A crossing
 * or unbudgeted spend that cannot be recorded throws, so its debit or sweep is re-driven; a
 * lifecycle fact and a first request are best effort: a key mutation or spend batch never fails.
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
      recordVkFirstRequest: commands.recordVkFirstRequest,
      recordUnbudgetedSpend: commands.recordUnbudgetedSpend,
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
        actor_user_id: toPersonActorId(signal.actorUserId),
        principal_user_id: virtualKey.principalUserId,
        purpose: virtualKey.purpose,
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

  /**
   * Records that a key served its first request, under the same tenant as its lifecycle facts.
   * A lost fact only leaves the person's has_app_request unset, so it is logged, never thrown:
   * the caller is appending billing records that must not be retried over it.
   */
  async recordVkFirstRequest(virtualKey: GatewayFirstRequestKey): Promise<void> {
    try {
      const sender = this.#senders.recordVkFirstRequest;
      if (!sender) return;
      const tenantId = await this.tenantOf(virtualKey);
      if (!tenantId) return;
      const data: RecordVkFirstRequestCommandData = {
        tenantId,
        organization_id: virtualKey.organizationId,
        virtual_key_id: virtualKey.id,
        occurred_at: this.clock().epochMilliseconds,
      };
      await sender.send(data);
    } catch (error) {
      logger.warn(
        { virtualKeyId: virtualKey.id, error },
        "failed to record a virtual key's first request (best effort)",
      );
    }
  }

  /**
   * Records an organization's unbudgeted spend under one stable organization project. Throws when
   * it cannot, so the sweep logs the organization and its next run tries again.
   */
  async recordUnbudgetedSpend(
    fact: Omit<RecordUnbudgetedSpendCommandData, "tenantId">,
  ): Promise<void> {
    const sender = this.#senders.recordUnbudgetedSpend;
    if (!sender) throw new Error("governance_events_processing is not registered in this process");
    const tenantId = await this.tenantOf({
      organizationId: fact.organization_id,
      traceProjectId: null,
    });
    if (!tenantId) return;
    const data: RecordUnbudgetedSpendCommandData = { tenantId, ...fact };
    await sender.send(data);
  }

  /** The key's trace project, else one stable organization project for event tenancy. */
  private async tenantOf(
    virtualKey: Pick<GatewayFirstRequestKey, "organizationId" | "traceProjectId">,
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
    principalUserId: string | null;
    purpose: VirtualKeyPurpose;
  };
  action: VkLifecycleAction;
  /** Who made the change, as its audit row records it: a person or a machine principal. */
  actorUserId: string;
  reason?: string | null;
};

/** The key whose first admitted request is recorded. */
export type GatewayFirstRequestKey = Readonly<{
  id: string;
  organizationId: string;
  traceProjectId: string | null;
}>;

export interface GatewayGovernanceSignals {
  emitVirtualKeyLifecycle(signal: GatewayVirtualKeyLifecycleSignal): Promise<void>;
}
