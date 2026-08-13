import type { ScopeAssignment } from "~/server/scopes/scope.types";
import {
  PLATFORM_DEFAULT_RETENTION_DAYS,
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
 * in the chain falls back to `PLATFORM_DEFAULT_RETENTION_DAYS` — the
 * platform-wide floor applied uniformly to every tenant (free and paid).
 * Overrides are a paid-plan feature; absence of overrides does NOT mean
 * indefinite retention, it means "use the platform default".
 */
export function resolveRetention({
  rows,
  chain,
}: {
  rows: RetentionRow[];
  chain: ScopeAssignment[];
}): ResolvedRetention {
  const resolved: ResolvedRetention = {
    traces: PLATFORM_DEFAULT_RETENTION_DAYS,
    scenarios: PLATFORM_DEFAULT_RETENTION_DAYS,
    experiments: PLATFORM_DEFAULT_RETENTION_DAYS,
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
