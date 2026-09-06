/**
 * The connected agents a run is pointed at that no process is holding
 * (ADR-128).
 *
 * A run against an offline agent is refused when it starts, so the dialog
 * says so before the person presses Run. The words are the ones the refusal
 * itself uses, read from the code-keyed registry, so the warning and the
 * error never drift apart.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

import type { TargetValue } from "~/components/scenarios/TargetSelector";
import { explainHandledError } from "~/features/errors";
import type { RunDialogAgent } from "./RunTargetPicker";

/** One agent of the run that is not running anywhere. */
export interface OfflineTarget {
  id: string;
  label: string;
}

/** The agents of these targets that are connected agents and are offline. */
export function offlineTargetsOf({
  agents,
  targets,
}: {
  agents: readonly RunDialogAgent[];
  targets: readonly TargetValue[];
}): OfflineTarget[] {
  const seen = new Set<string>();
  const offline: OfflineTarget[] = [];
  for (const target of targets) {
    if (target?.type !== "connected") continue;
    if (seen.has(target.id)) continue;
    seen.add(target.id);
    const agent = agents.find((candidate) => candidate.id === target.id);
    if (agent?.status !== "offline") continue;
    offline.push({ id: agent.id, label: agent.label ?? agent.name });
  }
  return offline;
}

/** What the dialog says about one offline agent, in the refusal's own words. */
export function offlineTargetMessage(target: OfflineTarget): string {
  const explanation = explainHandledError({
    code: "agent_offline",
    meta: { agentName: target.label },
    httpStatus: 503,
    fault: "customer",
    tips: [],
    docsUrl: undefined,
    traceId: undefined,
    reasons: [],
  });
  return explanation.description || explanation.title;
}
