/**
 * The authorization vocabulary: every scope tier, every principal kind, and
 * every spelling each of them has, declared exactly once.
 *
 * Before this module the same five tiers existed four times over — the
 * registry's lowercase `AuthzScopeType`, the binding's uppercase
 * `RoleBindingScopeType`, the event stream's `LedgerScopeType` and the
 * Grant table's `GrantScopeTypeDb` — each with its own membership. Two of
 * them were missing `resource`, two were missing `platform`, and nothing
 * caught it because no type connected them. Principals were worse: `apiKey`,
 * `api_key` and `API_KEY` in three hand-written translation tables.
 *
 * The declarations below are the source. Every union, every conversion and
 * every guard in the codebase derives from them, so a term added here
 * appears everywhere and a term spelled wrong anywhere is a type error.
 */

/**
 * The tiers a permission question can be asked at, narrowest first. Order is
 * containment: a grant at a later tier covers questions asked at an earlier
 * one, which is what `scopeChainFor` walks.
 */
export const SCOPE_TIERS = {
  resource: { stored: "RESOURCE" },
  project: { stored: "PROJECT" },
  team: { stored: "TEAM" },
  organization: { stored: "ORGANIZATION" },
  platform: { stored: "PLATFORM" },
} as const;

export type ScopeTier = keyof typeof SCOPE_TIERS;
export type StoredScopeTier = (typeof SCOPE_TIERS)[ScopeTier]["stored"];

export const SCOPE_TIER_NAMES = Object.keys(SCOPE_TIERS) as readonly ScopeTier[];

/**
 * The tiers a role binding may sit at. `resource` is excluded because a
 * resource is reached by a grant, not a binding; `platform` because operator
 * access is not granted through an organization.
 */
export const BINDING_SCOPE_TIERS = [
  "project",
  "team",
  "organization",
] as const satisfies readonly ScopeTier[];

export type BindingScopeTier = (typeof BINDING_SCOPE_TIERS)[number];
export type StoredBindingScopeTier =
  (typeof SCOPE_TIERS)[BindingScopeTier]["stored"];

/**
 * The kinds of thing a grant can name as its subject. `anyone` is the public
 * share expressed as a principal; it is the only kind with no id.
 */
export const PRINCIPAL_KINDS = {
  user: { stored: "USER", identified: true },
  apiKey: { stored: "API_KEY", identified: true },
  group: { stored: "GROUP", identified: true },
  team: { stored: "TEAM", identified: true },
  project: { stored: "PROJECT", identified: true },
  organization: { stored: "ORGANIZATION", identified: true },
  anyone: { stored: "ANYONE", identified: false },
} as const;

export type PrincipalKind = keyof typeof PRINCIPAL_KINDS;
export type StoredPrincipalKind = (typeof PRINCIPAL_KINDS)[PrincipalKind]["stored"];

export const PRINCIPAL_KIND_NAMES = Object.keys(
  PRINCIPAL_KINDS,
) as readonly PrincipalKind[];

/** The kinds that can be the caller of a request, as opposed to the subject
 *  of a grant. A team cannot make a request; it can only hold one. */
export const CALLER_KINDS = [
  "user",
  "apiKey",
  "anonymous",
] as const;

export type CallerKind = (typeof CALLER_KINDS)[number];

const STORED_SCOPE_TIER = Object.fromEntries(
  Object.entries(SCOPE_TIERS).map(([tier, spelling]) => [tier, spelling.stored]),
) as Record<ScopeTier, StoredScopeTier>;

const SCOPE_TIER_FROM_STORED = Object.fromEntries(
  Object.entries(SCOPE_TIERS).map(([tier, spelling]) => [spelling.stored, tier]),
) as Record<StoredScopeTier, ScopeTier>;

const STORED_PRINCIPAL_KIND = Object.fromEntries(
  Object.entries(PRINCIPAL_KINDS).map(([kind, spelling]) => [
    kind,
    spelling.stored,
  ]),
) as Record<PrincipalKind, StoredPrincipalKind>;

const PRINCIPAL_KIND_FROM_STORED = Object.fromEntries(
  Object.entries(PRINCIPAL_KINDS).map(([kind, spelling]) => [
    spelling.stored,
    kind,
  ]),
) as Record<StoredPrincipalKind, PrincipalKind>;

export const storedScopeTier = (tier: ScopeTier): StoredScopeTier =>
  STORED_SCOPE_TIER[tier];

export const scopeTierFromStored = (stored: StoredScopeTier): ScopeTier =>
  SCOPE_TIER_FROM_STORED[stored];

export const storedPrincipalKind = (kind: PrincipalKind): StoredPrincipalKind =>
  STORED_PRINCIPAL_KIND[kind];

export const principalKindFromStored = (
  stored: StoredPrincipalKind,
): PrincipalKind => PRINCIPAL_KIND_FROM_STORED[stored];

export const isScopeTier = (value: unknown): value is ScopeTier =>
  typeof value === "string" && value in SCOPE_TIERS;

export const isStoredScopeTier = (value: unknown): value is StoredScopeTier =>
  typeof value === "string" && value in SCOPE_TIER_FROM_STORED;

export const isPrincipalKind = (value: unknown): value is PrincipalKind =>
  typeof value === "string" && value in PRINCIPAL_KINDS;

export const isStoredPrincipalKind = (
  value: unknown,
): value is StoredPrincipalKind =>
  typeof value === "string" && value in PRINCIPAL_KIND_FROM_STORED;

export const isBindingScopeTier = (value: unknown): value is BindingScopeTier =>
  BINDING_SCOPE_TIERS.includes(value as BindingScopeTier);

/** Whether a principal of this kind carries an id. Only `anyone` does not. */
export const principalKindIsIdentified = (kind: PrincipalKind): boolean =>
  PRINCIPAL_KINDS[kind].identified;
