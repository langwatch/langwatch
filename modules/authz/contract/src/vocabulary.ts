/**
 * Principal vocabulary: grant subjects and caller kinds, declared once.
 * Every union, conversion, guard derives from these; spelling errors are
 * caught as type errors.
 */
import { z } from "zod";

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

export const STORED_PRINCIPAL_KIND = Object.fromEntries(
  Object.entries(PRINCIPAL_KINDS).map(([kind, spelling]) => [kind, spelling.stored]),
) as Record<PrincipalKind, StoredPrincipalKind>;

export const PRINCIPAL_KIND_FROM_STORED = Object.fromEntries(
  Object.entries(PRINCIPAL_KINDS).map(([kind, spelling]) => [spelling.stored, kind]),
) as Record<StoredPrincipalKind, PrincipalKind>;

// An own-property check, not `in`: an object literal inherits from
// Object.prototype, so `"constructor" in PRINCIPAL_KINDS` is true and would
// narrow an untrusted string to a kind whose lookup then yields a function.
// `hasOwnProperty.call` not `Object.hasOwn`: this package targets es2020.
const hasOwn = (object: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

export const isPrincipalKind = (value: unknown): value is PrincipalKind =>
  typeof value === "string" && hasOwn(PRINCIPAL_KINDS, value);

export const isStoredPrincipalKind = (value: unknown): value is StoredPrincipalKind =>
  typeof value === "string" && hasOwn(PRINCIPAL_KIND_FROM_STORED, value);

/** Whether a principal of this kind carries an id. Only `anyone` does not. */
export const principalKindIsIdentified = (kind: PrincipalKind): boolean =>
  PRINCIPAL_KINDS[kind].identified;
