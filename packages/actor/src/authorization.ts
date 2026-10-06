/**
 * ADR-166 / ADR-144: the `Authorization` proof.
 *
 * Minted at the door by `authz.authorize`, sealed here, and carried by hand
 * as the named parameter `authorization` from route to service to
 * repository. It is the union of every grant one call may touch, so it is
 * not itself a grant: one `own` grant for the project the caller holds
 * permissions on, and one `shared` grant per project that has been shared
 * with it, each naming the ledger grant it came through and the window it
 * opens. A store client applies it; nothing below the door evaluates
 * permissions again.
 *
 * Sealed means: the only object the client accepts is one this module
 * returned from `sealAuthorization`. A proof assembled by hand, however
 * well shaped, is refused as forged. The seal is a module-private set, not
 * a field, so it cannot be copied or spread onto another object.
 */
import { z } from "zod";
import { SYSTEM_ACTORS, type SystemActorName } from "./system-actors";

export const AUTHORIZATION_GRANT_KINDS = ["own", "shared"] as const;
export type AuthorizationGrantKind = (typeof AUTHORIZATION_GRANT_KINDS)[number];

export const AUTHORIZATION_CONDITION_TYPES = ["trace", "span", "log"] as const;
export type AuthorizationConditionType =
  (typeof AUTHORIZATION_CONDITION_TYPES)[number];

export const AUTHORIZATION_PURPOSE_KINDS = [
  "route",
  "event",
  "operator",
] as const;
export type AuthorizationPurposeKind =
  (typeof AUTHORIZATION_PURPOSE_KINDS)[number];

const systemActorNameSchema = z.enum(
  Object.keys(SYSTEM_ACTORS) as [SystemActorName, ...SystemActorName[]],
);

const actorSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("user"),
      id: z.string().min(1),
      impersonatorId: z.string().min(1).optional(),
    })
    .strict(),
  z.object({ type: z.literal("api_key"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("system"), name: systemActorNameSchema }).strict(),
  z
    .object({
      type: z.literal("internal"),
      codePath: z.string().min(1),
      revision: z.string().optional(),
    })
    .strict(),
]);

/** The window a shared grant opens. `from` and `until` are epoch
 *  milliseconds; `until` null means open-ended. `where` is an OTTL slot
 *  that nothing compiles in v1, so a minter must not copy a non-empty one. */
export const authorizationConditionSchema = z
  .object({
    type: z.enum(AUTHORIZATION_CONDITION_TYPES),
    where: z.string().optional(),
    from: z.number().int(),
    until: z.number().int().nullable(),
  })
  .strict();
export type AuthorizationCondition = z.infer<
  typeof authorizationConditionSchema
>;

export const authorizationGrantSchema = z
  .object({
    /** Absent: the organization tier (members, keys, SSO). */
    projectId: z.string().min(1).optional(),
    /** Own: the caller's full effective set. Shared: the grant's own. */
    permissions: z.array(z.string().min(1)).readonly(),
    /** Ledger grant ids, for "read via grant_2Xf9" in the audit. */
    via: z.array(z.string().min(1)).readonly(),
    kind: z.enum(AUTHORIZATION_GRANT_KINDS),
    condition: authorizationConditionSchema.optional(),
  })
  .strict()
  .refine((grant) => (grant.kind === "shared") === (grant.condition !== undefined), {
    message: "a shared grant carries a condition and an own grant carries none",
    path: ["condition"],
  })
  .refine((grant) => grant.kind === "own" || grant.projectId !== undefined, {
    message: "a shared grant names the project it reads",
    path: ["projectId"],
  });
export type AuthorizationGrant = z.infer<typeof authorizationGrantSchema>;

export const authorizationPurposeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("route"), route: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("event"), eventId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("operator"), entry: z.string().min(1) }).strict(),
]);
export type AuthorizationPurpose = z.infer<typeof authorizationPurposeSchema>;

export const authorizationSchema = z
  .object({
    actor: actorSchema,
    principal: z.discriminatedUnion("type", [
      z.object({ type: z.literal("user"), id: z.string().min(1) }).strict(),
      z.object({ type: z.literal("apiKey"), id: z.string().min(1) }).strict(),
      z.object({ type: z.literal("anonymous") }).strict(),
      z.object({ type: z.literal("project"), id: z.string().min(1) }).strict(),
      z.object({ type: z.literal("system"), name: systemActorNameSchema }).strict(),
    ]),
    scope: z.object({ organizationId: z.string().min(1) }).strict(),
    grants: z.array(authorizationGrantSchema).min(1).readonly(),
    /** Epoch milliseconds: the earliest contributing grant expiry, bounded
     *  by the minter's own ceiling. */
    expiresAt: z.number().int(),
    purpose: authorizationPurposeSchema,
  })
  .strict()
  .readonly();
export type AuthorizationInput = z.input<typeof authorizationSchema>;

declare const AUTHORIZATION_BRAND: unique symbol;
export type Authorization = z.infer<typeof authorizationSchema> & {
  readonly [AUTHORIZATION_BRAND]: true;
};

const sealed = new WeakSet<object>();

/** Validate and seal a proof. Only `authz.authorize` and its equivalents
 *  for events and operators call this; a store client checks the seal. */
export function sealAuthorization(input: AuthorizationInput): Authorization {
  const parsed = authorizationSchema.parse(input);
  const frozen = Object.freeze(parsed) as Authorization;
  sealed.add(frozen);
  return frozen;
}

export function isSealedAuthorization(value: unknown): value is Authorization {
  return typeof value === "object" && value !== null && sealed.has(value);
}

export class ForgedAuthorizationError extends Error {
  readonly code = "authorization_forged" as const;
  constructor() {
    super("The authorization was not minted by the authorizer");
    this.name = "ForgedAuthorizationError";
  }
}

export class AuthorizationExpiredError extends Error {
  readonly code = "authorization_expired" as const;
  constructor(readonly expiresAt: number) {
    super("The authorization has expired");
    this.name = "AuthorizationExpiredError";
  }
}

export class AccessNotGrantedError extends Error {
  readonly code = "access_not_granted" as const;
  constructor(readonly permission: string) {
    super(`No grant confers ${permission} on the requested scope`);
    this.name = "AccessNotGrantedError";
  }
}

export class TenantMismatchError extends Error {
  readonly code = "authorization_tenant_mismatch" as const;
  constructor(readonly organizationId: string) {
    super("The authorization does not cover the requested tenant");
    this.name = "TenantMismatchError";
  }
}

/**
 * The two checks every store client runs before touching a proof, returning
 * the proof narrowed to the sealed type. Forged is checked before expired:
 * an object that was never minted has no expiry worth reading.
 */
export function usableAuthorization({
  authorization,
  now,
}: {
  authorization: unknown;
  now: number;
}): Authorization {
  if (!isSealedAuthorization(authorization)) {
    throw new ForgedAuthorizationError();
  }
  if (authorization.expiresAt <= now) {
    throw new AuthorizationExpiredError(authorization.expiresAt);
  }
  return authorization;
}
