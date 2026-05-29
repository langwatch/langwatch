import type { ScopeAssignment } from "~/server/scopes/scope.types";
import {
  RETENTION_CATEGORIES,
  type ResolvedRetention,
} from "./retentionPolicy.schema";

/**
 * A stored retention override row, narrowed to the fields the cascade needs.
 */
export interface RetentionRow {
  scopeType: ScopeAssignment["scopeType"];
  scopeId: string;
  category: string;
  retentionDays: number;
}

/**
 * Resolve each category to the day count of its most-specific override.
 *
 * `chain` is the scope cascade most-specific-first (PROJECT → TEAM →
 * ORGANIZATION), as produced by `resolveScopeChain`. For each category we walk
 * the chain and take the first scope that has a row; categories resolve
 * independently, so a project can override `traces` while `scenarios` inherits
 * from the team and `experiments` from the org. A category with no row anywhere
 * in the chain resolves to 0 — indefinite retention (the cascade fell through).
 */
export function resolveRetention({
  rows,
  chain,
}: {
  rows: RetentionRow[];
  chain: ScopeAssignment[];
}): ResolvedRetention {
  const resolved: ResolvedRetention = {
    traces: 0,
    scenarios: 0,
    experiments: 0,
  };

  for (const category of RETENTION_CATEGORIES) {
    for (const scope of chain) {
      const row = rows.find(
        (r) =>
          r.scopeType === scope.scopeType &&
          r.scopeId === scope.scopeId &&
          r.category === category,
      );
      if (row) {
        resolved[category] = row.retentionDays;
        break;
      }
    }
  }

  return resolved;
}
