/**
 * ADR-166 / ADR-177: the `Authorization` proof, minted at the door and carried by hand as
 * `authorization` from route to service to repository. It unions every grant one call may touch.
 * Sealed: only an object `sealAuthorization` returned is accepted; a hand-built one is forged.
 */
import { z } from "zod";

import { braidConditionDigest, compiledWhereSchema } from "./braid-condition.ts";
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

/** The window a shared grant opens. `from` and `until` are epoch milliseconds; `until` null
 *  means open-ended. Only a `span` condition (a braid, ADR-183 §3) carries `compiledWhere`, and
 *  one with a non-empty `where` must, so no condition reaches a fence it cannot apply. */
export const authorizationConditionSchema = z
  .object({
    type: z.enum(AUTHORIZATION_CONDITION_TYPES),
    where: z.string().optional(),
    compiledWhere: compiledWhereSchema.optional(),
    from: z.number().int(),
    until: z.number().int().nullable(),
  })
  .strict()
  .refine((condition) => condition.compiledWhere === undefined || condition.type === "span", {
    message: "only a span condition carries a compiled where",
    path: ["compiledWhere"],
  })
  .refine(
    (condition) =>
      condition.type !== "span" ||
      (condition.where ?? "").trim() === "" ||
      condition.compiledWhere !== undefined,
    { message: "a span condition with a where carries its compiled form", path: ["compiledWhere"] },
  );
export type AuthorizationCondition = z.infer<typeof authorizationConditionSchema>;

/**
 * ADR-177 / ADR-166: the window as the ledger stores it on a SHARED grant. `type` names the
 * store resource, `where` is an unused OTTL slot, `from`/`until` are ISO instants; an own grant
 * has none. The minter turns this into an {@link AuthorizationCondition}.
 */
export const grantConditionSchema = z.object({
  type: z.enum(AUTHORIZATION_CONDITION_TYPES),
  where: z.string().optional(),
  compiledWhere: compiledWhereSchema.optional(),
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
     * The one project this proof reads, once narrowed (ADR-177 block F), so a detail page
     * cannot read a same-id trace of another member. Absent: every project its grants name.
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

/** A braid (ADR-183 §1): a shared grant whose window opens span reads alone, never trace reads. */
export function isSpanBraidGrant(grant: AuthorizationGrant): boolean {
  return grant.kind === "shared" && grant.condition?.type === "span";
}

/** Whether a proof is narrowed to one of its own projects, where its braids still read. */
function isNarrowedToOwn(authorization: Authorization): boolean {
  const { narrowedTo } = authorization;
  return (
    narrowedTo !== undefined &&
    authorization.grants.some((grant) => grant.kind === "own" && grant.projectId === narrowedTo)
  );
}

/**
 * The same proof narrowed to one project its grants name, never widened: the own grant, that
 * project's, and the braids when it is the own one (ADR-183 §5). A project named by no grant or
 * by braids alone is `null`, as a braid never opens an owner's trace. A forged proof is refused.
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
  const names = (grant: AuthorizationGrant) =>
    grant.projectId === projectId && !isSpanBraidGrant(grant);
  if (!authorization.grants.some(names)) return null;
  if (authorization.narrowedTo === projectId) return authorization;
  if (authorization.narrowedTo !== undefined) return null;
  const toOwn = authorization.grants.some(
    (grant) => grant.kind === "own" && grant.projectId === projectId,
  );
  return sealAuthorization({
    ...authorization,
    grants: authorization.grants.filter(
      (grant) => grant.kind === "own" || names(grant) || (toOwn && isSpanBraidGrant(grant)),
    ),
    narrowedTo: projectId,
  });
}

/** The projects a proof reads in: its grants under `permission` bar braids, cut to `narrowedTo`
 *  when set. */
export function projectIdsReadBy(
  authorization: Authorization,
  permission: ProofBearingPermission = "traces:view",
): string[] {
  const projects = authorization.grants
    .filter((grant) => grant.permissions.includes(permission))
    .filter((grant) => grant.kind === "own" || grant.condition?.type === "trace")
    .flatMap((grant) => grant.projectId ?? []);
  const { narrowedTo } = authorization;
  const read = narrowedTo === undefined ? projects : projects.filter((id) => id === narrowedTo);
  return [...new Set(read)].toSorted();
}

/** A shared grant's window: its project and epoch-millisecond bounds, `until` null when open. */
export type SharedWindow = Readonly<{ projectId: string; from: number; until: number | null }>;

/** The shared grants a proof reads in under `permission` and `condition`, cut to `narrowedTo`. */
export function sharedWindowsReadBy({
  authorization,
  permission,
  condition,
}: {
  authorization: Authorization;
  permission: ProofBearingPermission;
  condition: AuthorizationConditionType;
}): SharedWindow[] {
  const { narrowedTo } = authorization;
  return authorization.grants
    .filter((grant) => grant.kind === "shared" && grant.condition?.type === condition)
    .filter((grant) => grant.permissions.includes(permission))
    .flatMap(({ projectId, condition: window }) =>
      projectId === undefined || (narrowedTo !== undefined && projectId !== narrowedTo)
        ? []
        : [{ projectId, from: window?.from ?? 0, until: window?.until ?? null }],
    );
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

/** A stable key for the projects and windows a proof reads in under `permission`; an aggregate
 *  and a member never share one. A braid's window carries its condition's digest (ADR-183 §3). */
export function readScopeKeyOf(
  authorization: Authorization,
  permission: ProofBearingPermission = "traces:view",
): string {
  const { narrowedTo } = authorization;
  const braidsRead = narrowedTo === undefined || isNarrowedToOwn(authorization);
  return authorization.grants
    .filter((grant) => grant.permissions.includes(permission))
    .filter(
      (grant) =>
        narrowedTo === undefined ||
        grant.projectId === narrowedTo ||
        (braidsRead && isSpanBraidGrant(grant)),
    )
    .flatMap(({ kind, projectId, condition }) => {
      if (projectId === undefined) return [];
      if (kind === "own") return [projectId];
      const window = `${projectId}@${condition?.type ?? ""}:${condition?.from ?? 0}-${condition?.until ?? ""}`;
      const compiled = condition?.compiledWhere;
      return [compiled === undefined ? window : `${window}#${braidConditionDigest(compiled)}`];
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

/** Platform code asked for a proof on a project that no longer exists (deleted since its event). */
export class ProjectNotFoundError extends Error {
  readonly code = "project_not_found" as const;
  constructor(readonly projectId: string) {
    super(`Project ${projectId} no longer exists`);
    this.name = "ProjectNotFoundError";
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
 * The permissions a route's permission check mints a proof for: the trace read's, the
 * analytics read's and the cost read's, the three a shared grant's window applies to. Minting
 * for any other would cost an engine pass nothing consumes.
 */
const PROOF_BEARING = [
  "traces:view",
  "analytics:view",
  "cost:view",
] as const satisfies readonly AuthzPermission[];
/** A permission whose route check hands the handler its proof, typed so a door can say so. */
export type ProofBearingPermission = (typeof PROOF_BEARING)[number];
export const PROOF_BEARING_PERMISSIONS: ReadonlySet<AuthzPermission> = new Set<AuthzPermission>(
  PROOF_BEARING,
);
