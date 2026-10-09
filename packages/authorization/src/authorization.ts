/**
 * ADR-166 / ADR-177: the `Authorization` proof.
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

import type { AuthzPermission } from "./registry.ts";
import { SYSTEM_ACTORS, type SystemActorName } from "./system-actors.ts";

export const AUTHORIZATION_GRANT_KINDS = ["own", "shared"] as const;
export type AuthorizationGrantKind = (typeof AUTHORIZATION_GRANT_KINDS)[number];

export const AUTHORIZATION_CONDITION_TYPES = ["trace", "span", "log"] as const;
export type AuthorizationConditionType = (typeof AUTHORIZATION_CONDITION_TYPES)[number];

export const AUTHORIZATION_PURPOSE_KINDS = ["route", "event", "operator"] as const;
export type AuthorizationPurposeKind = (typeof AUTHORIZATION_PURPOSE_KINDS)[number];

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
export type AuthorizationCondition = z.infer<typeof authorizationConditionSchema>;

/**
 * ADR-177 / ADR-166: the same window as the ledger stores it on a SHARED
 * grant, the one shape both the event wire and the projection reader parse.
 * `type` names the store resource the window applies to; `where` is an OTTL
 * slot nothing compiles in v1 (the wire's shape refinement refuses a
 * non-empty one); `from` and `until` are ISO instants bounding the rows by
 * their occurrence time. An own grant carries no condition. The minter turns
 * this into an {@link AuthorizationCondition}.
 */
export const grantConditionSchema = z.object({
  type: z.enum(AUTHORIZATION_CONDITION_TYPES),
  where: z.string().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
});
export type GrantCondition = z.infer<typeof grantConditionSchema>;

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

export const authorizationSchema = z
  .object({
    actor: actorSchema,
    principal: z.discriminatedUnion("type", [
      z.object({ type: z.literal("user"), id: z.string().min(1) }).strict(),
      z.object({ type: z.literal("apiKey"), id: z.string().min(1) }).strict(),
      z.object({ type: z.literal("anonymous") }).strict(),
      z.object({ type: z.literal("project"), id: z.string().min(1) }).strict(),
      z.object({ type: z.literal("system"), name: systemActorNameSchema }).strict(),
      z.object({ type: z.literal("internal"), codePath: z.string().min(1) }).strict(),
    ]),
    scope: z.object({ organizationId: z.string().min(1) }).strict(),
    grants: z.array(authorizationGrantSchema).min(1).readonly(),
    /** Epoch milliseconds: the earliest contributing grant expiry, bounded
     *  by the minter's own ceiling. */
    expiresAt: z.number().int(),
    purpose: authorizationPurposeSchema,
    /**
     * The one project of the grants this proof reads, when it has been
     * narrowed to it (ADR-177 block F). A detail page opened from an
     * aggregate's list reads one member's trace, and two members may hold
     * the same trace id, so every read behind that page is narrowed to the
     * member the trace was found in. Absent: the proof reads every project
     * its grants name. Set only by {@link narrowAuthorization}.
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

/** Freeze an object and every object and array it reaches, so no part of a
 *  sealed proof can be rewritten after the seal is taken. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

/** Validate and seal a proof. Only `authz.authorize` and its equivalents
 *  for events and operators call this; a store client checks the seal. The
 *  proof is frozen all the way down before it is sealed, so the grants,
 *  their windows and the principal stay as they were minted. */
export function sealAuthorization(input: AuthorizationInput): Authorization {
  const parsed = authorizationSchema.parse(input);
  const frozen = deepFreeze(parsed) as Authorization;
  sealed.add(frozen);
  return frozen;
}

export function isSealedAuthorization(value: unknown): value is Authorization {
  return typeof value === "object" && value !== null && sealed.has(value);
}

/**
 * The same proof, narrowed to one of the projects its grants name. A proof
 * can be narrowed and never widened: the result keeps only the own grant,
 * which names the project every read is sent through, and the grants on the
 * narrowed project, so nothing reading the grants later can widen it back to
 * a project it was cut away from. The expiry and the purpose are copied
 * unchanged, and `narrowedTo` marks the cut for the store client's fence. A
 * project the proof does not name returns `null`, so the caller says what
 * that means at its own door (a detail route answers not found).
 *
 * Only a sealed proof is narrowed; a forged one is refused here as it would
 * be by the store client.
 */
export function narrowAuthorization({
  authorization,
  projectId,
}: {
  authorization: Authorization;
  projectId: string;
}): Authorization | null {
  if (!isSealedAuthorization(authorization)) {
    throw new ForgedAuthorizationError();
  }
  if (!authorization.grants.some((grant) => grant.projectId === projectId)) {
    return null;
  }
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

/** The projects a proof reads traces in: its `traces:view` grants, cut to `narrowedTo` when set. */
export function projectIdsReadBy(authorization: Authorization): string[] {
  const projects = authorization.grants
    .filter((grant) => grant.permissions.includes("traces:view"))
    .flatMap((grant) => grant.projectId ?? []);
  const { narrowedTo } = authorization;
  const read = narrowedTo === undefined ? projects : projects.filter((id) => id === narrowedTo);
  return [...new Set(read)].toSorted();
}

/** The own project a proof reads traces through, the one a route minted it for; narrowing
 *  does not move it. */
export function ownProjectIdReadBy(authorization: Authorization): string {
  const own = authorization.grants.find(
    (grant) => grant.kind === "own" && grant.permissions.includes("traces:view"),
  )?.projectId;
  if (own === undefined) throw new AccessNotGrantedError("traces:view");
  return own;
}

/** A stable key for the projects and windows a proof reads traces in; an aggregate and a
 *  member never share one. */
export function readScopeKeyOf(authorization: Authorization): string {
  const { narrowedTo } = authorization;
  return authorization.grants
    .filter((grant) => grant.permissions.includes("traces:view"))
    .filter((grant) => narrowedTo === undefined || grant.projectId === narrowedTo)
    .flatMap(({ kind, projectId, condition }) => {
      if (projectId === undefined) return [];
      if (kind === "own") return [projectId];
      return [
        `${projectId}@${condition?.type ?? ""}:${condition?.from ?? 0}-${condition?.until ?? ""}`,
      ];
    })
    .toSorted()
    .join(",");
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

/**
 * The permissions a route's permission check mints a proof for: only the
 * trace read's. Every read that applies a proof is checked under it, and
 * minting for any other would cost an engine pass nothing consumes.
 */
const PROOF_BEARING = ["traces:view"] as const satisfies readonly AuthzPermission[];
/** A permission whose route check hands the handler its proof, typed so a door can say so. */
export type ProofBearingPermission = (typeof PROOF_BEARING)[number];
export const PROOF_BEARING_PERMISSIONS: ReadonlySet<AuthzPermission> = new Set<AuthzPermission>(
  PROOF_BEARING,
);
