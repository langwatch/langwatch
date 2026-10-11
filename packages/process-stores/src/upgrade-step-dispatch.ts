/**
 * Upgrade steps' queue work runs ahead of any backlog: every job a step sends, and every job
 * those cause, is listed for the worker's second consumer (Alex, 2026-10-11).
 * Spec: specs/upgrade/background-steps.feature.
 */
import { EVENTING_QUEUE_NAME } from "@langwatch/eventing";
import { getCurrentContext, runWithContext } from "@langwatch/observability/context";

/** Where a queue lists the groups its upgrade-step consumer runs. */
export function upgradeStepGroupsKey({ queueName }: { queueName: string }): string {
  return `${queueName}:gq:upgrade-steps`;
}

/** Runs an upgrade step so the queue work it sends is listed for the upgrade-step consumer. */
export function runAsUpgradeStepWork<Result>(operation: () => Promise<Result>): Promise<Result> {
  const queueDispatchScopeKey = upgradeStepGroupsKey({ queueName: EVENTING_QUEUE_NAME });
  return runWithContext({ ...getCurrentContext(), queueDispatchScopeKey }, operation);
}
