import {
  CONTENT_CATEGORIES,
  type ContentCategory,
  type CustomAttributeDisposition,
  type Disposition,
  type PiiLevel,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type ResolvedAudience,
  type ResolvedCategory,
  type ResolvedCustomAttributeRule,
  type ResolvedDataPrivacy,
} from "./dataPrivacy.types";

/**
 * The most restrictive of several resolved privacy policies (ADR-144
 * decision 9). An aggregate project reads traces owned by its members, each
 * under its own policy, and one list mixes them; rather than redact row by
 * row, the whole read applies the strictest policy any member it reads
 * holds, the way the query API already does.
 *
 * Pure: the caller resolves each project through the per-project cache and
 * folds here, so a member's rule change reaches the next aggregate read on
 * the member's own cache entry and no aggregate-keyed entry can go stale.
 */
export function strictestDataPrivacy(
  policies: readonly ResolvedDataPrivacy[],
): ResolvedDataPrivacy {
  const [first, ...rest] = policies;
  if (first === undefined) return PLATFORM_DEFAULT_DATA_PRIVACY;
  if (rest.length === 0) return first;

  return {
    categories: Object.fromEntries(
      CONTENT_CATEGORIES.map((category) => [
        category,
        strictestCategory(policies.map((p) => p.categories[category])),
      ]),
    ) as Record<ContentCategory, ResolvedCategory>,
    pii: {
      level: strictestOf(
        policies.map((p) => p.pii.level),
        PII_STRICTNESS,
      ),
      entities: union(policies.map((p) => p.pii.entities)),
      // An exception removes redaction, so only one every member allows
      // survives.
      exceptPatterns: intersection(policies.map((p) => p.pii.exceptPatterns)),
    },
    secrets: {
      enabled: policies.some((p) => p.secrets.enabled),
      customPatterns: union(policies.map((p) => p.secrets.customPatterns)),
    },
    customAttributes: strictestCustomAttributes(
      policies.flatMap((p) => p.customAttributes),
    ),
  };
}

/** Rank per value, higher is stricter. */
const DISPOSITION_STRICTNESS: Record<Disposition, number> = {
  capture: 0,
  restrict: 1,
  drop: 2,
};

const PII_STRICTNESS: Record<PiiLevel, number> = {
  disabled: 0,
  essential: 1,
  custom: 2,
  strict: 3,
};

const CUSTOM_ATTRIBUTE_STRICTNESS: Record<CustomAttributeDisposition, number> =
  {
    restrict: 0,
    drop: 1,
  };

function strictestOf<V extends string>(
  values: readonly V[],
  rank: Record<V, number>,
): V {
  return values.reduce((strictest, value) =>
    rank[value] > rank[strictest] ? value : strictest,
  );
}

/**
 * The strictest disposition wins. Only the members that hold it shape the
 * audience: a capture's audience means nothing, and where several members
 * restrict, a reader must be in every one of their audiences.
 */
function strictestCategory(
  settings: readonly ResolvedCategory[],
): ResolvedCategory {
  const disposition = strictestOf(
    settings.map((setting) => setting.disposition),
    DISPOSITION_STRICTNESS,
  );
  return {
    disposition,
    audience: intersectAudiences(
      settings
        .filter((setting) => setting.disposition === disposition)
        .map((setting) => setting.audience),
    ),
  };
}

function strictestCustomAttributes(
  rules: readonly ResolvedCustomAttributeRule[],
): ResolvedCustomAttributeRule[] {
  const byPattern = new Map<string, ResolvedCustomAttributeRule[]>();
  for (const rule of rules) {
    byPattern.set(rule.pattern, [...(byPattern.get(rule.pattern) ?? []), rule]);
  }
  return [...byPattern.entries()].map(([pattern, held]) => {
    const disposition = strictestOf(
      held.map((rule) => rule.disposition),
      CUSTOM_ATTRIBUTE_STRICTNESS,
    );
    return {
      pattern,
      disposition,
      audience: intersectAudiences(
        held
          .filter((rule) => rule.disposition === disposition)
          .map((rule) => rule.audience),
      ),
    };
  });
}

const EVERYONE: ResolvedAudience = {
  admins: false,
  allMembers: true,
  members: false,
  viewers: false,
  projectOwner: false,
  groupIds: [],
};

/**
 * Who is in every one of these audiences. `allMembers` is everyone with
 * project access, so it adds no constraint of its own: intersected with a
 * narrower audience it leaves that audience.
 */
function intersectAudiences(
  audiences: readonly ResolvedAudience[],
): ResolvedAudience {
  const narrowing = audiences.filter((audience) => !audience.allMembers);
  const [first, ...rest] = narrowing;
  // Every audience was everyone: keep one of them as it is.
  if (first === undefined) return { ...EVERYONE, ...audiences[0] };
  return rest.reduce<ResolvedAudience>(
    (kept, audience) => ({
      admins: kept.admins && audience.admins,
      allMembers: false,
      members: kept.members && audience.members,
      viewers: kept.viewers && audience.viewers,
      projectOwner: kept.projectOwner && audience.projectOwner,
      groupIds: kept.groupIds.filter((id) => audience.groupIds.includes(id)),
    }),
    { ...first, groupIds: [...first.groupIds] },
  );
}

function union(lists: readonly (readonly string[])[]): string[] {
  return [...new Set(lists.flat())];
}

function intersection(lists: readonly (readonly string[])[]): string[] {
  const [first, ...rest] = lists;
  if (first === undefined) return [];
  return [...new Set(first)].filter((value) =>
    rest.every((list) => list.includes(value)),
  );
}
