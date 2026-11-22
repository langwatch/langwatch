/**
 * Whether a scope's last change reached its stored data. An apply covers its own scope and every
 * scope it holds (organization > team > project), since it rewrites each project to the period
 * that project resolves to. Pure. Spec: modules/data-retention/specs/retention-apply-record.feature
 */
import type { RetentionScopeType, StoredApplyStatus } from "@langwatch/data-retention-contract";

type ScopeRef = Readonly<{ scopeType: RetentionScopeType; scopeId: string }>;

/** A saved rule row; its `updatedAt` counts as a change even when the record of it was lost. */
type ScopeRule = ScopeRef & Readonly<{ updatedAt?: Date }>;

/** What the status projection keeps per scope. */
export type ScopeApplyRecord = ScopeRef &
  Readonly<{ changedAt: number | null; appliedAt: number | null }>;

export function retentionApplyStatusKey({
  organizationId,
  scopeType,
  scopeId,
}: ScopeRef & { organizationId: string }): string {
  return `${organizationId}:${scopeType}:${scopeId}`;
}

const refKey = ({ scopeType, scopeId }: ScopeRef): string => `${scopeType}:${scopeId}`;

/**
 * One status per asked scope with a recorded change; a scope whose rule predates the record has
 * none. `teamOfProject` places a project under its team so the team's apply covers it.
 */
export function storedApplyStatuses({
  organizationId,
  scopes,
  records,
  teamOfProject,
}: {
  organizationId: string;
  scopes: readonly ScopeRule[];
  records: readonly ScopeApplyRecord[];
  teamOfProject: ReadonlyMap<string, string>;
}): StoredApplyStatus[] {
  const byScope = new Map(records.map((record) => [refKey(record), record]));
  const appliedAt = (scope: ScopeRef): number | null =>
    byScope.get(refKey(scope))?.appliedAt ?? null;

  const coveringScopes = (scope: ScopeRef): ScopeRef[] => {
    const organization: ScopeRef = { scopeType: "ORGANIZATION", scopeId: organizationId };
    if (scope.scopeType === "ORGANIZATION") return [scope];
    if (scope.scopeType === "TEAM") return [scope, organization];
    const teamId = teamOfProject.get(scope.scopeId);
    return [
      scope,
      ...(teamId ? [{ scopeType: "TEAM" as const, scopeId: teamId }] : []),
      organization,
    ];
  };

  const savedAt = new Map<string, number>();
  for (const scope of scopes) {
    const at = scope.updatedAt?.getTime();
    if (at !== undefined) savedAt.set(refKey(scope), Math.max(at, savedAt.get(refKey(scope)) ?? at));
  }

  const seen = new Set<string>();
  const statuses: StoredApplyStatus[] = [];
  for (const scope of scopes) {
    if (seen.has(refKey(scope))) continue;
    seen.add(refKey(scope));
    const recorded = byScope.get(refKey(scope))?.changedAt ?? null;
    if (recorded === null) continue;
    const changedAt = Math.max(recorded, savedAt.get(refKey(scope)) ?? recorded);
    const covering = coveringScopes(scope)
      .map(appliedAt)
      .filter((at): at is number => at !== null && at >= changedAt);
    statuses.push(
      covering.length > 0
        ? { ...pick(scope), status: "applied", at: Math.max(...covering) }
        : { ...pick(scope), status: "pending", at: changedAt },
    );
  }
  return statuses;
}

const pick = ({ scopeType, scopeId }: ScopeRef): ScopeRef => ({ scopeType, scopeId });
