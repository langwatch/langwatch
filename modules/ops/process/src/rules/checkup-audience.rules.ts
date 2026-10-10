import type { CheckupResult } from "@langwatch/ops-contract";

/**
 * What an organization caller reads of a checkup: each row and its outcome, and none
 * of the words that name the install's hosts, ports, env vars or versions.
 * Spec: modules/ops/specs/checkup-audience.feature
 */
export function checkupVerdictsOnly(result: CheckupResult): CheckupResult {
  return {
    ranAt: result.ranAt,
    rows: result.rows.map(({ id, name, group, cost, verdict }) => ({
      id,
      name,
      group,
      cost,
      verdict: { outcome: verdict.outcome },
    })),
  };
}
