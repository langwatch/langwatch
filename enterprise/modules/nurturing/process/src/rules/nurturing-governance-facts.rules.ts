// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What Customer.io is told of governance's ingestion-source facts: the organization learns it has
 * a source and then data, traits only ever set true, and one current member gets the event: the
 * source's creator, else the organization's admin. A payload carries the source's id and type and
 * the organization only: never its name, configuration or secret.
 * Spec: enterprise/modules/nurturing/specs/governance-facts.feature
 */
import type { IngestionSourceFactData } from "@langwatch/enterprise-governance-contract/ingestion-source-lifecycle";
import type {
  CioBatchCall,
  CioEventName,
  CioOrgTraits,
  NurturingSignal,
  NurturingSignalOf,
} from "@langwatch/enterprise-nurturing-contract";

type GovernanceSourceConnectedSignal = NurturingSignalOf<"governance_source_connected">;
type GovernanceSourceLiveSignal = NurturingSignalOf<"governance_source_live">;
const GOVERNANCE_SOURCE_KINDS = ["governance_source_connected", "governance_source_live"] as const;

export type GovernanceSourceSignal = NurturingSignalOf<(typeof GOVERNANCE_SOURCE_KINDS)[number]>;

/** The signals governance's source facts make: each Customer.io call is claimed on its own. */
export function isGovernanceSourceSignal(
  signal: NurturingSignal,
): signal is GovernanceSourceSignal {
  return (GOVERNANCE_SOURCE_KINDS as readonly string[]).includes(signal.kind);
}

/** Each kind's claim on its source: a source is connected once and goes live once. */
const SOURCE_EVENT_SUFFIX: Readonly<Record<GovernanceSourceSignal["kind"], string>> = {
  governance_source_connected: "connected",
  governance_source_live: "live",
};

/** A source fact as its recipient's signal, once per source and kind. */
export function governanceSourceSignal({
  kind,
  data,
  userId,
}: Readonly<{
  kind: GovernanceSourceSignal["kind"];
  data: IngestionSourceFactData;
  /** The source's creator while a current member, else the organization's admin. */
  userId: string;
}>): GovernanceSourceSignal {
  return {
    kind,
    sourceEventId: `${data.sourceId}:${SOURCE_EVENT_SUFFIX[kind]}`,
    tenantId: data.tenantId,
    occurredAt: data.occurredAt,
    userId,
    organizationId: data.organizationId,
    sourceId: data.sourceId,
    sourceType: data.sourceType,
  };
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

/** The organization has a governance source; its recipient is told it was connected. */
function fireGovernanceSourceConnected(signal: GovernanceSourceConnectedSignal): CioBatchCall[] {
  return companyTraitThenEvent({
    signal,
    traits: { has_governance_source: true },
    event: "governance_source_connected",
  });
}

/** The organization has governance data; its recipient is told the source went live. */
function fireGovernanceSourceLive(signal: GovernanceSourceLiveSignal): CioBatchCall[] {
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
