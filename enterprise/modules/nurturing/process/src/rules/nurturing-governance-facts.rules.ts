// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What Customer.io is told of governance's ingestion-source facts: the organization learns it has
 * a source and then data, traits only ever set true, and the person who created the source gets
 * the event. A payload carries the source's id and type and the organization only: never its
 * name, configuration or secret. The fact names its person, so no copy is read.
 * Spec: enterprise/modules/nurturing/specs/governance-facts.feature
 */
import type { IngestionSourceFactData } from "@langwatch/enterprise-governance-contract";
import type {
  CioBatchCall,
  CioEventName,
  CioOrgTraits,
  NurturingSignal,
  NurturingSignalOf,
} from "@langwatch/enterprise-nurturing-contract";

export type GovernanceSourceConnectedSignal = NurturingSignalOf<"governance_source_connected">;
export type GovernanceSourceLiveSignal = NurturingSignalOf<"governance_source_live">;
const GOVERNANCE_SOURCE_KINDS = ["governance_source_connected", "governance_source_live"] as const;

export type GovernanceSourceSignal = NurturingSignalOf<(typeof GOVERNANCE_SOURCE_KINDS)[number]>;

/** The signals governance's source facts make: each Customer.io call is claimed on its own. */
export function isGovernanceSourceSignal(
  signal: NurturingSignal,
): signal is GovernanceSourceSignal {
  return (GOVERNANCE_SOURCE_KINDS as readonly string[]).includes(signal.kind);
}

/** What both signals carry from the fact, told to the person who created the source. */
function sourceSignalFields(
  data: IngestionSourceFactData,
  userId: string,
): Omit<GovernanceSourceSignal, "kind" | "sourceEventId"> {
  return {
    tenantId: data.tenantId,
    occurredAt: data.occurredAt,
    userId,
    organizationId: data.organizationId,
    sourceId: data.sourceId,
    sourceType: data.sourceType,
  };
}

/** A created source as its creator's signal, once per source. */
export function governanceSourceConnectedSignals({
  data,
}: Readonly<{ data: IngestionSourceFactData }>): GovernanceSourceConnectedSignal[] {
  if (data.actorUserId === null) return [];
  return [
    {
      kind: "governance_source_connected",
      sourceEventId: `${data.sourceId}:connected`,
      ...sourceSignalFields(data, data.actorUserId),
    },
  ];
}

/** A source's first data as its creator's signal, once per source. */
export function governanceSourceLiveSignals({
  data,
}: Readonly<{ data: IngestionSourceFactData }>): GovernanceSourceLiveSignal[] {
  if (data.actorUserId === null) return [];
  return [
    {
      kind: "governance_source_live",
      sourceEventId: `${data.sourceId}:live`,
      ...sourceSignalFields(data, data.actorUserId),
    },
  ];
}

/**
 * The Company's trait, then the person's event under the signal's own id as its Customer.io
 * message id, so a resend after the delivery claim expired is still dropped by Customer.io.
 */
function companyTraitThenEvent({
  signal,
  traits,
  event,
}: Readonly<{
  signal: GovernanceSourceSignal;
  traits: Partial<CioOrgTraits>;
  event: CioEventName;
}>): CioBatchCall[] {
  const { userId, organizationId } = signal;
  return [
    { type: "group", userId, groupId: organizationId, traits },
    {
      type: "track",
      userId,
      event,
      properties: {
        source_id: signal.sourceId,
        source_type: signal.sourceType,
        organization_id: organizationId,
      },
      messageId: signal.sourceEventId,
    },
  ];
}

/** The organization has a governance source; its creator is told they connected it. */
export function fireGovernanceSourceConnected(
  signal: GovernanceSourceConnectedSignal,
): CioBatchCall[] {
  return companyTraitThenEvent({
    signal,
    traits: { has_governance_source: true },
    event: "governance_source_connected",
  });
}

/** The organization has governance data; the source's creator is told it went live. */
export function fireGovernanceSourceLive(signal: GovernanceSourceLiveSignal): CioBatchCall[] {
  return companyTraitThenEvent({
    signal,
    traits: { has_governance_data: true },
    event: "governance_source_live",
  });
}

/** The calls a governance source signal makes, in the order they are sent. */
export function fireGovernanceSourceSignal(signal: GovernanceSourceSignal): CioBatchCall[] {
  switch (signal.kind) {
    case "governance_source_connected":
      return fireGovernanceSourceConnected(signal);
    case "governance_source_live":
      return fireGovernanceSourceLive(signal);
  }
}
