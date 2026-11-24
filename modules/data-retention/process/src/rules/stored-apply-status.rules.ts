/**
 * Whether a scope's last change reached its stored data. An exact apply covers its own scope and
 * every scope it holds (organization > team > project); a raise covers only its own scope, and
 * only when no shorter save since the last exact apply left stamps above it. Pure. Spec:
 * modules/data-retention/specs/retention-apply-record.feature */
import type { RetentionScopeType, StoredApplyStatus } from "@langwatch/data-retention-contract";

type ScopeRef = Readonly<{ scopeType: RetentionScopeType; scopeId: string }>;

/** A saved rule; `savedAt` (epoch ms) counts as a change even when the record of it was lost. */
type ScopeRule = ScopeRef & Readonly<{ savedAt?: number }>;

/** What the status projection keeps per scope (see `RetentionApplyStatusState`). */
export type ScopeApplyRecord = ScopeRef &
  Readonly<{
    changedAt: number | null;
    appliedAt: number | null;
    raisedAt?: number | null;
    shortenedAt?: number | null;
  }>;

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

/** A raise covers the change when it came after it, with no shorter save since the last apply. */
function raiseCovers({
  record,
  changedAt,
  lastExactApply,
}: {
  record: ScopeApplyRecord | undefined;
  changedAt: number;
  lastExactApply: number | null;
}): boolean {
  const raisedAt = record?.raisedAt ?? null;
  if (raisedAt === null || raisedAt < changedAt) return false;
  const shortenedAt = record?.shortenedAt ?? null;
  return shortenedAt === null || (lastExactApply !== null && shortenedAt <= lastExactApply);
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

  return lastChanges({ scopes, byScope }).map(({ scope, changedAt }): StoredApplyStatus => {
    const exactApplies = coveringScopes(scope)
      .map(appliedAt)
      .filter((at): at is number => at !== null);
    const covering = exactApplies.filter((at) => at >= changedAt);
    if (covering.length > 0) return { ...scope, status: "applied", at: Math.max(...covering) };
    const record = byScope.get(refKey(scope));
    const lastExactApply = exactApplies.length > 0 ? Math.max(...exactApplies) : null;
    return raiseCovers({ record, changedAt, lastExactApply })
      ? { ...scope, status: "applied", at: record?.raisedAt ?? changedAt }
      : { ...scope, status: "pending", at: changedAt };
  });
}

const pick = ({ scopeType, scopeId }: ScopeRef): ScopeRef => ({ scopeType, scopeId });
