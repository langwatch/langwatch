/**
 * ADR-166 / ADR-175: the `Authorization` proof authz mints at the door, carried by hand as
 * `authorization` to the store client: one `own` grant plus one `shared` grant per project shared
 * with it. Only `sealAuthorization`'s result is sealed (a module-private set), so a copy is not.
 */
import { HandledError } from "@langwatch/handled-error";
import { z } from "zod";

import { actorSchema, systemActorNameSchema } from "./actor.ts";
import { AUTHORIZATION_CONDITION_TYPES } from "./decision.ts";

export const AUTHORIZATION_GRANT_KINDS = ["own", "shared"] as const;
export type AuthorizationGrantKind = (typeof AUTHORIZATION_GRANT_KINDS)[number];

export const AUTHORIZATION_PURPOSE_KINDS = ["route", "event", "operator"] as const;
export type AuthorizationPurposeKind = (typeof AUTHORIZATION_PURPOSE_KINDS)[number];

/** The window a shared grant opens. `from` and `until` are epoch milliseconds; `until` null is
 *  open-ended. `where` is an OTTL slot nothing compiles yet, so a minter never copies one. */
export const authorizationConditionSchema = z
  .object({
    type: z.enum(AUTHORIZATION_CONDITION_TYPES),
    where: z.string().optional(),
    from: z.number().int(),
    until: z.number().int().nullable(),
  })
  .strict();
export type AuthorizationCondition = z.infer<typeof authorizationConditionSchema>;

export const authorizationGrantSchema = z
  .object({
    /** Absent: the organisation tier (members, keys, SSO). */
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

export const authorizationPrincipalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("apiKey"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("anonymous") }).strict(),
  z.object({ type: z.literal("project"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("system"), name: systemActorNameSchema }).strict(),
  z.object({ type: z.literal("internal"), codePath: z.string().min(1) }).strict(),
]);
export type AuthorizationPrincipal = z.infer<typeof authorizationPrincipalSchema>;

export const authorizationSchema = z
  .object({
    actor: actorSchema,
    principal: authorizationPrincipalSchema,
    scope: z.object({ organizationId: z.string().min(1) }).strict(),
    grants: z.array(authorizationGrantSchema).min(1).readonly(),
    /** Epoch milliseconds: the earliest contributing grant expiry, under the minter's ceiling. */
    expiresAt: z.number().int(),
    purpose: authorizationPurposeSchema,
    /**
     * The one project of the grants this proof reads, once narrowed to it: two members may hold
     * the same trace id, so a detail read is narrowed to the member it was found in. Absent: every
     * project the grants name. Set only by {@link narrowAuthorization}.
     */
    narrowedTo: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (proof) =>
      proof.narrowedTo === undefined ||
      proof.grants.some((grant) => grant.projectId === proof.narrowedTo),
    {
      message: "a narrowed proof names a project one of its grants reads",
      path: ["narrowedTo"],
    },
  )
  .readonly();
export type AuthorizationInput = z.input<typeof authorizationSchema>;

declare const AUTHORIZATION_BRAND: unique symbol;
export type Authorization = z.infer<typeof authorizationSchema> & {
  readonly [AUTHORIZATION_BRAND]: true;
};

const sealed = new WeakSet<object>();

/** Freeze an object and everything it reaches, so no part of a sealed proof can be rewritten. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

/** Validate, freeze all the way down and seal a proof. Only authz's minter calls this; a store
 *  client checks the seal. */
export function sealAuthorization(input: AuthorizationInput): Authorization {
  const frozen = deepFreeze(authorizationSchema.parse(input)) as Authorization;
  sealed.add(frozen);
  return frozen;
}

export function isSealedAuthorization(value: unknown): value is Authorization {
  return typeof value === "object" && value !== null && sealed.has(value);
}

/**
 * The proof narrowed to one project its grants name (own grant plus that project's), never
 * widened: a project it does not name, or another once narrowed, answers null for the caller's
 * door to word. A proof that was never sealed is refused as forged.
 */
export function narrowAuthorization({
  authorization,
  projectId,
}: {
  authorization: Authorization;
  projectId: string;
}): Authorization | null {
  if (!isSealedAuthorization(authorization)) throw new ForgedAuthorizationError();
  if (!authorization.grants.some((grant) => grant.projectId === projectId)) return null;
  if (authorization.narrowedTo === projectId) return authorization;
  if (authorization.narrowedTo !== undefined) return null;
  return sealAuthorization({
    ...authorization,
    grants: authorization.grants.filter(
      (grant) => grant.kind === "own" || grant.projectId === projectId,
    ),
    narrowedTo: projectId,
  });
}

/** A store client was handed a proof the minter never sealed: a platform defect, never input. */
export class ForgedAuthorizationError extends HandledError {
  declare readonly code: "authorization_forged";

  constructor() {
    super("authorization_forged", "The authorization was not minted by the authorizer", {
      httpStatus: 500,
      fault: "platform",
    });
    this.name = "ForgedAuthorizationError";
  }
}

/** The proof outlived its expiry before the read it was minted for ran. */
export class AuthorizationExpiredError extends HandledError {
  declare readonly code: "authorization_expired";
  readonly expiresAt: number;

  constructor({ expiresAt }: { expiresAt: number }) {
    super("authorization_expired", "The authorization has expired", {
      httpStatus: 500,
      fault: "platform",
    });
    this.name = "AuthorizationExpiredError";
    this.expiresAt = expiresAt;
  }
}

/** No grant confers the permission on the scope asked for; an unknown scope reads the same. */
export class AccessNotGrantedError extends HandledError {
  declare readonly code: "access_not_granted";

  constructor({ permission }: { permission: string }) {
    super("access_not_granted", `No grant confers ${permission} on the requested scope`, {
      httpStatus: 403,
      fault: "customer",
      meta: { permission },
    });
    this.name = "AccessNotGrantedError";
  }
}

/**
 * The two checks every store client runs before touching a proof, answering it as the sealed
 * type. Forged is checked before expired: an object never minted has no expiry worth reading.
 */
export function usableAuthorization({
  authorization,
  now,
}: {
  authorization: unknown;
  now: number;
}): Authorization {
  if (!isSealedAuthorization(authorization)) throw new ForgedAuthorizationError();
  if (authorization.expiresAt <= now) {
    throw new AuthorizationExpiredError({ expiresAt: authorization.expiresAt });
  }
  return authorization;
}
