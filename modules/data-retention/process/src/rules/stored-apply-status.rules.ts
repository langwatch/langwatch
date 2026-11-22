/**
 * Whether a scope's last change reached its stored data. An apply covers its own scope and every
 * scope it holds (organization > team > project), since it rewrites each project to the period
 * that project resolves to. Pure. Spec: modules/data-retention/specs/retention-apply-record.feature
 */
import type { RetentionScopeType, StoredApplyStatus } from "@langwatch/data-retention-contract";

type ScopeRef = Readonly<{ scopeType: RetentionScopeType; scopeId: string }>;

/** A saved rule; `savedAt` (epoch ms) counts as a change even when the record of it was lost. */
type ScopeRule = ScopeRef & Readonly<{ savedAt?: number }>;

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

/** Each scope with a recorded change, once, at the later of its recorded change and its saves. */
function lastChanges({
  scopes,
  byScope,
}: {
  scopes: readonly ScopeRule[];
  byScope: ReadonlyMap<string, ScopeApplyRecord>;
}): { scope: ScopeRef; changedAt: number }[] {
  const changes = new Map<string, { scope: ScopeRef; changedAt: number }>();
  for (const scope of scopes) {
    const key = refKey(scope);
    const recorded = byScope.get(key)?.changedAt ?? null;
    if (recorded === null) continue;
    const previous = changes.get(key)?.changedAt ?? recorded;
    const changedAt = Math.max(previous, scope.savedAt ?? recorded);
    changes.set(key, { scope: changes.get(key)?.scope ?? pick(scope), changedAt });
  }
  return [...changes.values()];
}

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

  return lastChanges({ scopes, byScope }).map(({ scope, changedAt }) => {
    const covering = coveringScopes(scope)
      .map(appliedAt)
      .filter((at): at is number => at !== null && at >= changedAt);
    return covering.length > 0
      ? { ...scope, status: "applied", at: Math.max(...covering) }
      : { ...scope, status: "pending", at: changedAt };
  });
}

const pick = ({ scopeType, scopeId }: ScopeRef): ScopeRef => ({ scopeType, scopeId });
