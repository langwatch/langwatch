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
import { z } from "zod";

/**
 * The tiers a permission question can be asked at, narrowest first. Order is
 * containment: a grant at a later tier covers questions asked at an earlier
 * one, which is what `scopeChainFor` walks.
 */
export const SCOPE_TIERS = {
  resource: { stored: "RESOURCE" },
  project: { stored: "PROJECT", field: "projectId" },
  team: { stored: "TEAM", field: "teamId" },
  organization: { stored: "ORGANIZATION", field: "organizationId" },
  platform: { stored: "PLATFORM" },
} as const;

export const SCOPE_TIER_NAMES = Object.keys(SCOPE_TIERS) as readonly ScopeTier[];
export const scopeTierSchema = z.enum(
  Object.keys(SCOPE_TIERS) as [keyof typeof SCOPE_TIERS, ...(keyof typeof SCOPE_TIERS)[]],
);
export type ScopeTier = z.infer<typeof scopeTierSchema>;

export const storedScopeTierSchema = z.enum([
  "RESOURCE",
  "PROJECT",
  "TEAM",
  "ORGANIZATION",
  "PLATFORM",
]);
export type StoredScopeTier = z.infer<typeof storedScopeTierSchema>;

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

export const bindingScopeTierSchema = z.enum(BINDING_SCOPE_TIERS);
export type BindingScopeTier = z.infer<typeof bindingScopeTierSchema>;

/**
 * The input field naming each binding tier — the same three tiers, spelled
 * the way a procedure input spells them. Declared on the tiers above rather
 * than in a table of its own, so a tier cannot have a field here and no
 * stored spelling there.
 */
export const SCOPE_TIER_FIELDS = {
  project: SCOPE_TIERS.project.field,
  team: SCOPE_TIERS.team.field,
  organization: SCOPE_TIERS.organization.field,
} as const;

export type ScopeTierField = (typeof SCOPE_TIER_FIELDS)[BindingScopeTier];

/** The tier a scope field names — the reverse of SCOPE_TIER_FIELDS. */
export const SCOPE_TIER_BY_FIELD = {
  projectId: "project",
  teamId: "team",
  organizationId: "organization",
} as const satisfies Record<ScopeTierField, BindingScopeTier>;
export const storedBindingScopeTierSchema = z.enum(["PROJECT", "TEAM", "ORGANIZATION"]);
export type StoredBindingScopeTier = z.infer<typeof storedBindingScopeTierSchema>;

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

export const PRINCIPAL_KIND_NAMES = Object.keys(PRINCIPAL_KINDS) as readonly PrincipalKind[];
export const principalKindSchema = z.enum(
  Object.keys(PRINCIPAL_KINDS) as [
    keyof typeof PRINCIPAL_KINDS,
    ...(keyof typeof PRINCIPAL_KINDS)[],
  ],
);
export type PrincipalKind = z.infer<typeof principalKindSchema>;

export const storedPrincipalKindSchema = z.enum([
  "USER",
  "API_KEY",
  "GROUP",
  "TEAM",
  "PROJECT",
  "ORGANIZATION",
  "ANYONE",
]);
export type StoredPrincipalKind = z.infer<typeof storedPrincipalKindSchema>;

/** The kinds that can be the caller of a request, as opposed to the subject
 *  of a grant. A team cannot make a request; it can only hold one. */
export const CALLER_KINDS = ["user", "apiKey", "anonymous"] as const;

export const callerKindSchema = z.enum(CALLER_KINDS);
export type CallerKind = z.infer<typeof callerKindSchema>;

export const STORED_SCOPE_TIER = Object.fromEntries(
  Object.entries(SCOPE_TIERS).map(([tier, spelling]) => [tier, spelling.stored]),
) as Record<ScopeTier, StoredScopeTier>;

export const SCOPE_TIER_FROM_STORED = Object.fromEntries(
  Object.entries(SCOPE_TIERS).map(([tier, spelling]) => [spelling.stored, tier]),
) as Record<StoredScopeTier, ScopeTier>;

export const STORED_PRINCIPAL_KIND = Object.fromEntries(
  Object.entries(PRINCIPAL_KINDS).map(([kind, spelling]) => [kind, spelling.stored]),
) as Record<PrincipalKind, StoredPrincipalKind>;

export const PRINCIPAL_KIND_FROM_STORED = Object.fromEntries(
  Object.entries(PRINCIPAL_KINDS).map(([kind, spelling]) => [spelling.stored, kind]),
) as Record<StoredPrincipalKind, PrincipalKind>;

// An own-property check, not `in`: an object literal inherits from
// Object.prototype, so `"constructor" in SCOPE_TIERS` and
// `"toString" in SCOPE_TIERS` are both true and would narrow those untrusted
// strings to a tier, whose table lookup then yields a function rather than a
// member. `hasOwnProperty.call` rather than `Object.hasOwn` because this
// package targets es2020 on purpose (it is isomorphic).
const hasOwn = (object: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

export const isScopeTier = (value: unknown): value is ScopeTier =>
  typeof value === "string" && hasOwn(SCOPE_TIERS, value);

export const isStoredScopeTier = (value: unknown): value is StoredScopeTier =>
  typeof value === "string" && hasOwn(SCOPE_TIER_FROM_STORED, value);

export const isPrincipalKind = (value: unknown): value is PrincipalKind =>
  typeof value === "string" && hasOwn(PRINCIPAL_KINDS, value);

export const isStoredPrincipalKind = (value: unknown): value is StoredPrincipalKind =>
  typeof value === "string" && hasOwn(PRINCIPAL_KIND_FROM_STORED, value);

export const isBindingScopeTier = (value: unknown): value is BindingScopeTier =>
  BINDING_SCOPE_TIERS.includes(value as BindingScopeTier);

/** Whether a principal of this kind carries an id. Only `anyone` does not. */
export const principalKindIsIdentified = (kind: PrincipalKind): boolean =>
  PRINCIPAL_KINDS[kind].identified;
