// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The kill switch's words: stop statuses, target kinds and severities as a reader says them.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import {
  AGENT_STOP_RESTORABLE_STATUSES,
  AGENT_STOP_RETRYABLE_STATUSES,
  AGENT_STOP_TARGET_KINDS,
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

/** Whether `other` acts on what `target` acts on, as far as the browser can tell. */
function isSameResource({
  target,
  other,
}: {
  target: AgentStopTarget;
  other: AgentStopTarget;
}): boolean {
  switch (target.kind) {
    case "gateway_virtual_key":
      return other.kind === target.kind && other.virtualKeyId === target.virtualKeyId;
    case "databricks_serving_endpoint":
      return (
        other.kind === target.kind &&
        other.endpointName === target.endpointName &&
        other.ingestionSourceId === target.ingestionSourceId
      );
    case "bedrock_agent_alias":
      return (
        other.kind === target.kind &&
        other.region === target.region &&
        other.agentId === target.agentId &&
        other.agentAliasId === target.agentAliasId
      );
  }
}

/** Another open stop holds a target while it is applied or an approved stop is about to apply it. */
function isHolding({
  holder,
  outcome,
}: {
  holder: AgentStopView;
  outcome: AgentStopView["targets"][number];
}): boolean {
  if (outcome.state === "applied") return true;
  return outcome.state === "pending" && holder.status === "stopping";
}

export type SharedTargetHolders = { kind: AgentStopTargetKind; holders: string[] };

/** Whether `holder`, another agent's open stop, holds one of `targets`. */
function holdsAnyOf({
  holder,
  targets,
}: {
  holder: AgentStopView;
  targets: readonly AgentStopTarget[];
}): boolean {
  return holder.targets.some(
    (outcome) =>
      isHolding({ holder, outcome }) &&
      targets.some((target) => isSameResource({ target, other: outcome.target })),
  );
}

/**
 * The other agents whose open stop holds one of `stop`'s targets, per target kind: restoring
 * `stop` leaves that target off until they are restored too.
 */
export function sharedTargetHoldersOf({
  stop,
  summaries,
}: {
  stop: AgentStopView | null;
  summaries: readonly AgentKillSwitchSummary[];
}): SharedTargetHolders[] {
  if (!stop) return [];
  const others = summaries.flatMap(({ openStop }) =>
    openStop && openStop.id !== stop.id ? [openStop] : [],
  );
  return AGENT_STOP_TARGET_KINDS.flatMap((kind) => {
    const targets = stop.targets.flatMap(({ target }) => (target.kind === kind ? [target] : []));
    if (targets.length === 0) return [];
    const holders = others
      .filter((holder) => holdsAnyOf({ holder, targets }))
      .map((holder) => holder.agentName);
    return holders.length > 0 ? [{ kind, holders }] : [];
  });
}

const SHARED_TARGET_WORDS: Record<AgentStopTargetKind, { noun: string; stays: string }> = {
  gateway_virtual_key: { noun: "virtual key", stays: "stays disabled" },
  databricks_serving_endpoint: { noun: "serving endpoint", stays: "stays stopped" },
  bedrock_agent_alias: { noun: "Bedrock alias", stays: "stays off" },
};

/** The Restore dialog's note on a shared target, worded for its kind and for one holder or several. */
export function sharedTargetNoteOf({ kind, holders }: SharedTargetHolders): string {
  const { noun, stays } = SHARED_TARGET_WORDS[kind];
  const names = new Intl.ListFormat("en-GB", { type: "conjunction" }).format(holders);
  const verb = holders.length > 1 ? "are" : "is";
  return `The ${noun} ${stays} while ${names} ${verb} still stopped.`;
}

/** The Restore toast's line on what stays off, or null when nothing is shared. */
export function sharedTargetToastOf({
  shared,
}: {
  shared: readonly SharedTargetHolders[];
}): string | null {
  const [only] = shared;
  if (!only) return null;
  if (shared.length > 1) return "The shared targets stay off.";
  const { noun, stays } = SHARED_TARGET_WORDS[only.kind];
  return `The shared ${noun} ${stays}.`;
}
