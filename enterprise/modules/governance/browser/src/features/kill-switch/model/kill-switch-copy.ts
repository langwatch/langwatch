// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The kill switch's words: stop statuses, target kinds and severities as a reader says them.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import {
  AGENT_STOP_RESTORABLE_STATUSES,
  AGENT_STOP_RETRYABLE_STATUSES,
  type AgentKillSwitchSummary,
  type AgentStopSeverity,
  type AgentStopStatus,
  type AgentStopTarget,
  type AgentStopTargetKind,
  type AgentStopView,
} from "@langwatch/enterprise-governance-contract";

/** The statuses a chip shows. Restored and denied stops are over, so they show nothing. */
const STOP_STATUS_LABELS: Record<AgentStopStatus, string | null> = {
  pending_approval: "Pending approval",
  denied: null,
  stopping: "Stopping",
  quarantined: "Quarantined",
  stop_failed: "Stop failed",
  restoring: "Restoring",
  restored: null,
  restore_failed: "Restore failed",
};

export type StopStatusPalette = "orange" | "blue" | "red";

const STOP_STATUS_PALETTES: Record<AgentStopStatus, StopStatusPalette> = {
  pending_approval: "orange",
  denied: "orange",
  stopping: "blue",
  quarantined: "red",
  stop_failed: "red",
  restoring: "blue",
  restored: "blue",
  restore_failed: "red",
};

export function stopStatusChip(
  status: AgentStopStatus,
): { label: string; palette: StopStatusPalette } | null {
  const label = STOP_STATUS_LABELS[status];
  return label === null ? null : { label, palette: STOP_STATUS_PALETTES[status] };
}

export const isRestorableStop = (status: AgentStopStatus) =>
  AGENT_STOP_RESTORABLE_STATUSES.includes(status);

/** The menu's name for stopping an open stop again, or null when it cannot be: a failed one is retried. */
export function retryStopLabelOf(status: AgentStopStatus): string | null {
  if (!AGENT_STOP_RETRYABLE_STATUSES.includes(status)) return null;
  return status === "quarantined" ? "Stop again" : "Retry stop";
}

export const STOP_TARGET_KIND_LABELS: Record<AgentStopTargetKind, string> = {
  databricks_serving_endpoint: "Databricks serving endpoint",
  bedrock_agent_alias: "Bedrock agent alias",
  gateway_virtual_key: "Gateway virtual key",
};

export const STOP_SEVERITY_LABELS: Record<AgentStopSeverity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const STOP_SEVERITY_PALETTES: Record<AgentStopSeverity, "gray" | "orange" | "red"> = {
  low: "gray",
  medium: "orange",
  high: "red",
  critical: "red",
};

/** The label a new plan row gets: what the target names on its own platform. */
export function describeStopTarget(target: AgentStopTarget): string {
  switch (target.kind) {
    case "databricks_serving_endpoint":
      return target.endpointName;
    case "bedrock_agent_alias":
      return `${target.agentId}/${target.agentAliasId} in ${target.region}`;
    case "gateway_virtual_key":
      return target.virtualKeyId;
  }
}

export function stopRequesterLabel(stop: AgentStopView): string {
  if (stop.trigger === "api_key") return "an API key";
  return "a team member";
}

/** The kill switch state of each Agents-page row, keyed by the row's id. */
export function summariesByRowId(
  summaries: readonly AgentKillSwitchSummary[],
): ReadonlyMap<string, AgentKillSwitchSummary> {
  const byRow = new Map<string, AgentKillSwitchSummary>();
  for (const summary of summaries) {
    if (summary.inventoryRowId) byRow.set(summary.inventoryRowId, summary);
  }
  return byRow;
}

/** Another open stop holds a key while its target is applied or an approved stop is about to apply it. */
function holdsSharedKey({
  holder,
  outcome,
  keys,
}: {
  holder: AgentStopView;
  outcome: AgentStopView["targets"][number];
  keys: ReadonlySet<string>;
}): boolean {
  if (outcome.target.kind !== "gateway_virtual_key") return false;
  if (!keys.has(outcome.target.virtualKeyId)) return false;
  if (outcome.state === "applied") return true;
  return outcome.state === "pending" && holder.status === "stopping";
}

/**
 * The other agents whose open stop holds one of `stop`'s virtual keys disabled: restoring `stop`
 * leaves that key disabled until they are restored too.
 */
export function sharedKeyHoldersOf({
  stop,
  summaries,
}: {
  stop: AgentStopView | null;
  summaries: readonly AgentKillSwitchSummary[];
}): string[] {
  if (!stop) return [];
  const keys = new Set(
    stop.targets.flatMap((outcome) =>
      outcome.target.kind === "gateway_virtual_key" ? [outcome.target.virtualKeyId] : [],
    ),
  );
  if (keys.size === 0) return [];
  return summaries.flatMap(({ openStop }) => {
    if (!openStop || openStop.id === stop.id) return [];
    const holds = openStop.targets.some((outcome) =>
      holdsSharedKey({ holder: openStop, outcome, keys }),
    );
    return holds ? [openStop.agentName] : [];
  });
}
