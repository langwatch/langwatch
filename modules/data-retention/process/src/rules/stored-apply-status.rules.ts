/**
 * Whether a scope's last change reached its stored data. An exact apply covers its own scope and
 * every scope it holds (organization > team > project); a raise covers only its own scope, and
 * only when no shorter save since the last exact apply left stamps above it. Pure. Spec:
 * modules/data-retention/specs/retention-apply-record.feature */
import type {
  RetentionCategory,
  RetentionScopeType,
  StoredApplyStatus,
} from "@langwatch/data-retention-contract";

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
    shortenedAtByCategory?: ShortenedAtByCategory | null;
  }>;

/** Per category, the latest change that kept fewer days (epoch ms). */
export type ShortenedAtByCategory = Readonly<Partial<Record<RetentionCategory, number>>>;

export function retentionApplyStatusKey({
  organizationId,
  scopeType,
  scopeId,
}: ScopeRef & { organizationId: string }): string {
  return `${organizationId}:${scopeType}:${scopeId}`;
}

const refKey = ({ scopeType, scopeId }: ScopeRef): string => `${scopeType}:${scopeId}`;

/**
 * Each scope once, at the latest of its recorded change and its saves. A scope with no recorded
 * change still counts its saves when an apply reached it, so a lost change record cannot hide it.
 */
function lastChanges({
  scopes,
  byScope,
  reached,
}: {
  scopes: readonly ScopeRule[];
  byScope: ReadonlyMap<string, ScopeApplyRecord>;
  reached: (scope: ScopeRef) => boolean;
}): { scope: ScopeRef; changedAt: number }[] {
  const changes = new Map<string, { scope: ScopeRef; changedAt: number }>();
  for (const scope of scopes) {
    const key = refKey(scope);
    const recorded = byScope.get(key)?.changedAt ?? null;
    if (recorded === null && !reached(scope)) continue;
    const at = Math.max(recorded ?? -1, scope.savedAt ?? -1);
    if (at < 0) continue;
    const changedAt = Math.max(changes.get(key)?.changedAt ?? at, at);
    changes.set(key, { scope: changes.get(key)?.scope ?? pick(scope), changedAt });
  }
  return [...changes.values()];
}

/** The scopes whose exact apply covers `scope`, itself first (organization > team > project). */
function coveringScopes({
  organizationId,
  scope,
  teamOfProject,
}: {
  organizationId: string;
  scope: ScopeRef;
  teamOfProject: ReadonlyMap<string, string>;
}): ScopeRef[] {
  const organization: ScopeRef = { scopeType: "ORGANIZATION", scopeId: organizationId };
  if (scope.scopeType === "ORGANIZATION") return [scope];
  if (scope.scopeType === "TEAM") return [scope, organization];
  const teamId = teamOfProject.get(scope.scopeId);
  return [
    scope,
    ...(teamId ? [{ scopeType: "TEAM" as const, scopeId: teamId }] : []),
    organization,
  ];
}

/**
 * Whether a shorter save of `category` on the project's chain still waits for an exact apply at
 * its scope or a wider one: the admin chose not to apply it, so stamps above the period are
 * expected. A record folded before shortenings were kept per category defers nothing.
 */
export function hasDeferredShortening({
  organizationId,
  projectId,
  category,
  records,
  teamOfProject,
}: {
  organizationId: string;
  projectId: string;
  category: RetentionCategory;
  records: readonly ScopeApplyRecord[];
  teamOfProject: ReadonlyMap<string, string>;
}): boolean {
  const byScope = new Map(records.map((record) => [refKey(record), record]));
  const chain = coveringScopes({
    organizationId,
    scope: { scopeType: "PROJECT", scopeId: projectId },
    teamOfProject,
  });
  return chain.some((scope, index) => {
    const shortenedAt = byScope.get(refKey(scope))?.shortenedAtByCategory?.[category] ?? null;
    if (shortenedAt === null) return false;
    return chain
      .slice(index)
      .every((wider) => (byScope.get(refKey(wider))?.appliedAt ?? -1) < shortenedAt);
  });
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
 * One status per asked scope with a recorded change or an apply that reached it; a scope whose
 * rule predates both has none. `teamOfProject` places a project under its team so the team's
 * apply covers it.
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
  const covering = (scope: ScopeRef) => coveringScopes({ organizationId, scope, teamOfProject });
  const reached = (scope: ScopeRef): boolean =>
    covering(scope).some((wider) => appliedAt(wider) !== null) ||
    (byScope.get(refKey(scope))?.raisedAt ?? null) !== null;

  return lastChanges({ scopes, byScope, reached }).map(
    ({ scope, changedAt }): StoredApplyStatus => {
      const exactApplies = covering(scope)
        .map(appliedAt)
        .filter((at): at is number => at !== null);
      const afterChange = exactApplies.filter((at) => at >= changedAt);
      if (afterChange.length > 0) {
        return { ...scope, status: "applied", at: Math.max(...afterChange) };
      }
      const record = byScope.get(refKey(scope));
      const lastExactApply = exactApplies.length > 0 ? Math.max(...exactApplies) : null;
      return raiseCovers({ record, changedAt, lastExactApply })
        ? { ...scope, status: "applied", at: record?.raisedAt ?? changedAt }
        : { ...scope, status: "pending", at: changedAt };
    },
  );
}

const pick = ({ scopeType, scopeId }: ScopeRef): ScopeRef => ({ scopeType, scopeId });
