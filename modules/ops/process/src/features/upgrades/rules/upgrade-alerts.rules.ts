import { Temporal } from "@langwatch/time";
import type { UpgradeStatus, UpgradeStepView } from "@langwatch/upgrade/reader";

export type UpgradeAlert =
  | { kind: "step-failed"; stepId: string; error: string | null }
  | { kind: "lease-expired"; owner: string | null; host: string | null };

function isWithin({ iso, since, until }: { iso: string | null; since: number; until: number }) {
  if (iso === null) return false;
  const at = Temporal.Instant.from(iso).epochMilliseconds;
  return at > since && at <= until;
}

/**
 * What became worth telling an operator in (since, until]: a step that failed in the window, or
 * a lease that expired in it (its runner died). Alerting on the window, not the state, tells
 * each incident once; the banner carries the standing state. Spec: upgrade-alerts.feature
 */
export function upgradeAlertsBetween({
  status,
  failedSteps,
  since,
  until,
}: {
  status: Pick<UpgradeStatus, "lease">;
  failedSteps: readonly Pick<UpgradeStepView, "id" | "lastError" | "updatedAt" | "finishedAt">[];
  since: number;
  until: number;
}): UpgradeAlert[] {
  const alerts: UpgradeAlert[] = failedSteps
    .filter((step) => isWithin({ iso: step.updatedAt ?? step.finishedAt, since, until }))
    .map((step) => ({ kind: "step-failed", stepId: step.id, error: step.lastError }));
  const { lease } = status;
  if (lease && isWithin({ iso: lease.expiresAt, since, until })) {
    alerts.push({ kind: "lease-expired", owner: lease.owner, host: lease.host });
  }
  return alerts;
}
