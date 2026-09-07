/**
 * The directory sync aggregate (D08, ADR-117 §5).
 *
 * One `ScimSync` per SSO connection: a token is minted for a connection, that
 * connection's pushes are its history, and tearing the connection down ends
 * it. The aggregate holds no PII — a person appears as a `userId` and the
 * directory's own `externalId`, never as an email or a name (the D01 payload
 * rule) — because what this history is FOR is answering "which connection
 * pushed this, and did it land", not "who is this person".
 *
 *   [*] ──token minted for a connection──► TOKEN_ISSUED
 *        TOKEN_ISSUED ──first push──────► SYNCING
 *        SYNCING ⇄ ERROR                 (apply failed / retried with backoff)
 *        SYNCING ──revoked or torn down─► REVOKED
 *        ERROR   ──revoked or torn down─► REVOKED
 *
 * Membership consequences are NOT facts here. A push that adds somebody to
 * an organization states `scim_user_pushed` on this aggregate and dispatches
 * `grants.attach` on the grants ledger, whose own `grant_attached` fact
 * carries `source: "scim"`. Two histories, each answering its own question:
 * this one says a directory asked, the ledger says who now holds what.
 *
 * The actor is NOT the connection. `SYSTEM_ACTORS` (@langwatch/actor) is a
 * closed registry of named principals and a connection id is a per-customer
 * value, so a membership fact is stamped `system:scim` however many
 * connections an organization has, and WHICH connection pushed it lives on
 * these events, which carry `connectionId`. Cross-organization safety comes
 * from what the TOKEN may reach, never from the actor stamp.
 *
 * Pure and isomorphic like the rest of this package: no reads, no writes, no
 * env, no node built-ins.
 *
 * See specs/identity/scim-connection-sync.feature.
 */
import { z } from "zod";
import { identityActorSchema } from "./vocabulary";

export const SCIM_SYNC_EVENT_VERSION_LATEST = "2026-08-24" as const;

// ---- lifecycle -----------------------------------------------------------

/**
 * Where a connection's directory sync stands. `TOKEN_ISSUED` is "wired but
 * never used", which is worth telling apart from `SYNCING`: an identity
 * provider that was configured and has never pushed is a setup that stalled,
 * and it looks nothing like one that is working.
 */
export const SCIM_SYNC_STATES = [
  "TOKEN_ISSUED",
  "SYNCING",
  "ERROR",
  "REVOKED",
] as const;
export const scimSyncStateSchema = z.enum(SCIM_SYNC_STATES);
export type ScimSyncLifecycleState = z.infer<typeof scimSyncStateSchema>;

/** What a push did to one person, as the directory asked for it. */
export const SCIM_USER_OPS = ["create", "update", "deactivate"] as const;
export const scimUserOpSchema = z.enum(SCIM_USER_OPS);
export type ScimUserOp = z.infer<typeof scimUserOpSchema>;

/**
 * The operations a failure can be attributed to. Coarser than the SCIM verb
 * on purpose: what an administrator needs from the failure surface is "the
 * directory could not remove somebody", not `PATCH /Users/:id`.
 */
export const SCIM_APPLY_OPS = [
  "push_user",
  "deactivate_user",
  "delete_user",
  "map_group",
] as const;
export const scimApplyOpSchema = z.enum(SCIM_APPLY_OPS);
export type ScimApplyOp = z.infer<typeof scimApplyOpSchema>;

/** Why a sync ended. Both end the same way; only the cause differs. */
export const SCIM_REVOKE_CAUSES = ["revoke", "teardown"] as const;
export const scimRevokeCauseSchema = z.enum(SCIM_REVOKE_CAUSES);
export type ScimRevokeCause = z.infer<typeof scimRevokeCauseSchema>;

// ---- events --------------------------------------------------------------

export const SCIM_TOKEN_ISSUED_EVENT_TYPE =
  "lw.identity.scim_token_issued" as const;
export const SCIM_USER_PUSHED_EVENT_TYPE =
  "lw.identity.scim_user_pushed" as const;
export const SCIM_GROUP_MAPPED_EVENT_TYPE =
  "lw.identity.scim_group_mapped" as const;
export const SCIM_APPLY_FAILED_EVENT_TYPE =
  "lw.identity.scim_apply_failed" as const;
export const SCIM_APPLY_RECOVERED_EVENT_TYPE =
  "lw.identity.scim_apply_recovered" as const;
export const SCIM_APPLY_RETIRED_EVENT_TYPE =
  "lw.identity.scim_apply_retired" as const;
export const SCIM_APPLY_REDRIVEN_EVENT_TYPE =
  "lw.identity.scim_apply_redriven" as const;
export const SCIM_TOKEN_REVOKED_EVENT_TYPE =
  "lw.identity.scim_token_revoked" as const;

export const SCIM_SYNC_EVENT_TYPES = [
  SCIM_TOKEN_ISSUED_EVENT_TYPE,
  SCIM_USER_PUSHED_EVENT_TYPE,
  SCIM_GROUP_MAPPED_EVENT_TYPE,
  SCIM_APPLY_FAILED_EVENT_TYPE,
  SCIM_APPLY_RECOVERED_EVENT_TYPE,
  SCIM_APPLY_RETIRED_EVENT_TYPE,
  SCIM_APPLY_REDRIVEN_EVENT_TYPE,
  SCIM_TOKEN_REVOKED_EVENT_TYPE,
] as const;
export type ScimSyncEventType = (typeof SCIM_SYNC_EVENT_TYPES)[number];

const syncIdentity = {
  scimSyncId: z.string().min(1),
  connectionId: z.string().min(1),
  organizationId: z.string().min(1),
};

export const scimTokenIssuedPayloadSchema = z.object({
  ...syncIdentity,
  /** The token ROW's id. Never the token, never its hash: this history is
   *  read by support surfaces, and a credential has no business in it. */
  tokenId: z.string().min(1),
  actor: identityActorSchema,
});

export const scimUserPushedPayloadSchema = z.object({
  ...syncIdentity,
  userId: z.string().min(1),
  /** The directory's own identifier for the person, which is what survives
   *  their email changing. Scoped by connection, never global. */
  externalId: z.string().min(1),
  op: scimUserOpSchema,
});

export const scimGroupMappedPayloadSchema = z.object({
  ...syncIdentity,
  groupId: z.string().min(1),
  /** The group's identifier in the directory, when the push carried one. */
  externalId: z.string().min(1).nullable(),
});

/**
 * An apply that failed. `errorCode` is a stable slug and `detail` is our own
 * short sentence — never a provider's raw message, which is where a token or
 * a hostname would arrive from.
 */
export const scimApplyFailedPayloadSchema = z.object({
  ...syncIdentity,
  op: scimApplyOpSchema,
  errorCode: z.string().min(1),
  /** Whether another attempt could plausibly succeed. `false` retires it. */
  retryable: z.boolean(),
  /** The person the failed apply was about, when it was about one. */
  userId: z.string().min(1).nullable(),
});

export const scimApplyRecoveredPayloadSchema = z.object({
  ...syncIdentity,
  op: scimApplyOpSchema,
});

/**
 * The dead letter. A failure that will never succeed is retired HERE and
 * stays readable, because the alternative — dropping it — reports the
 * directory's requested state as reached when it was not.
 */
export const scimApplyRetiredPayloadSchema = z.object({
  ...syncIdentity,
  op: scimApplyOpSchema,
  errorCode: z.string().min(1),
  attempts: z.number().int().nonnegative(),
  userId: z.string().min(1).nullable(),
});

/**
 * The one write the operator surface has (ADR-122): a retired apply is sent
 * through again, once its cause has been fixed.
 *
 * It names WHICH dead letter by the business time it was retired at, because
 * a connection can hold several and "re-drive the failure" is not an
 * instruction anybody could check. The operator rides on the fact rather than
 * only in the audit trail: a re-drive is authority exercised across a tenant
 * boundary, and the tenant's own history is where that has to be readable.
 */
export const scimApplyRedrivenPayloadSchema = z.object({
  ...syncIdentity,
  op: scimApplyOpSchema,
  errorCode: z.string().min(1),
  userId: z.string().min(1).nullable(),
  /** Business time of the retirement this re-drive answers. */
  retiredAtMs: z.number().int().nonnegative(),
  /** The platform operator who sent it through again. */
  actor: identityActorSchema,
});

export const scimTokenRevokedPayloadSchema = z.object({
  ...syncIdentity,
  tokenId: z.string().min(1).nullable(),
  cause: scimRevokeCauseSchema,
});

/**
 * A sync fact as a command decides it. The framework envelope (aggregate,
 * tenant, ids, idempotency key) and `occurredAt` are stamped by whoever
 * appends.
 */
export const scimSyncFactInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(SCIM_TOKEN_ISSUED_EVENT_TYPE),
    data: scimTokenIssuedPayloadSchema,
  }),
  z.object({
    type: z.literal(SCIM_USER_PUSHED_EVENT_TYPE),
    data: scimUserPushedPayloadSchema,
  }),
  z.object({
    type: z.literal(SCIM_GROUP_MAPPED_EVENT_TYPE),
    data: scimGroupMappedPayloadSchema,
  }),
  z.object({
    type: z.literal(SCIM_APPLY_FAILED_EVENT_TYPE),
    data: scimApplyFailedPayloadSchema,
  }),
  z.object({
    type: z.literal(SCIM_APPLY_RECOVERED_EVENT_TYPE),
    data: scimApplyRecoveredPayloadSchema,
  }),
  z.object({
    type: z.literal(SCIM_APPLY_RETIRED_EVENT_TYPE),
    data: scimApplyRetiredPayloadSchema,
  }),
  z.object({
    type: z.literal(SCIM_APPLY_REDRIVEN_EVENT_TYPE),
    data: scimApplyRedrivenPayloadSchema,
  }),
  z.object({
    type: z.literal(SCIM_TOKEN_REVOKED_EVENT_TYPE),
    data: scimTokenRevokedPayloadSchema,
  }),
]);
export type ScimSyncFactInput = z.infer<typeof scimSyncFactInputSchema>;

/** A fact with its business time — what the reducer folds. */
export type ScimSyncFact = ScimSyncFactInput & { occurredAt: number };

// ---- folded state --------------------------------------------------------

/**
 * The last thing that went wrong, as the failure surface reads it. It names
 * the connection, the operation and a reason code, and it carries no token,
 * no secret and no internal hostname — the payload schemas above are what
 * make that true rather than a promise.
 */
export interface ScimSyncFailure {
  op: ScimApplyOp;
  errorCode: string;
  /** How many failed applies have accumulated since the last recovery. */
  attempts: number;
  /** Set once the failure is retired: it will not be retried again. */
  retiredAtMs: number | null;
  /**
   * Set once a platform operator has sent the retired apply through again
   * (ADR-122). Null on every failure nobody has re-driven — which is also
   * what makes a second re-drive state nothing: the dead letter itself
   * carries whether the act has already happened, so idempotency is a
   * property of the history rather than of whoever pressed the control.
   */
  redrivenAtMs: number | null;
  /** The person it was about, when it was about one. */
  userId: string | null;
  occurredAtMs: number;
}

/** One connection's directory sync as the projection knows it. */
export interface ScimSyncState {
  scimSyncId: string;
  connectionId: string;
  organizationId: string;
  state: ScimSyncLifecycleState;
  /** Business time of the last push this connection made, if any. */
  lastPushedAtMs: number | null;
  lastFailure: ScimSyncFailure | null;
  /** Every failure retired without ever being applied — the dead letters an
   *  administrator has to see, newest last. Retiring never drops one. */
  deadLetters: ScimSyncFailure[];
  revokedCause: ScimRevokeCause | null;
  createdAtMs: number;
  updatedAtMs: number;
}

/**
 * The sync's aggregate id, derived rather than stored.
 *
 * A connection has exactly one directory sync — a second one would be a
 * second answer to "is this directory working", which is the question the
 * whole aggregate exists to answer — so the connection id IS the sync id.
 * Deriving it means no lookup table stands between a token and its history,
 * and no code path can mint a sync a connection does not know about.
 */
export function scimSyncIdFor({
  connectionId,
}: {
  connectionId: string;
}): string {
  return connectionId;
}

export function emptyScimSync({
  scimSyncId,
}: {
  scimSyncId: string;
}): ScimSyncState {
  return {
    scimSyncId,
    connectionId: "",
    organizationId: "",
    state: "TOKEN_ISSUED",
    lastPushedAtMs: null,
    lastFailure: null,
    deadLetters: [],
    revokedCause: null,
    createdAtMs: 0,
    updatedAtMs: 0,
  };
}

/**
 * The reducer. Pure and total: every fact answers a next state, and the same
 * function runs in the framework's fold, in the replay proof and in a
 * browser tab.
 *
 * REVOKED is terminal and absorbing. A push that arrives after a teardown is
 * a token that should already have stopped verifying, so folding it as a
 * return to SYNCING would report a torn-down connection as healthy; the
 * refusal happens at the boundary, and this makes the history agree with it.
 */
export function reduceScimSync({
  state,
  fact,
}: {
  state: ScimSyncState;
  fact: ScimSyncFact;
}): ScimSyncState {
  const touched = { ...state, updatedAtMs: fact.occurredAt };
  if (state.state === "REVOKED") return touched;

  switch (fact.type) {
    case SCIM_TOKEN_ISSUED_EVENT_TYPE:
      return {
        ...touched,
        scimSyncId: fact.data.scimSyncId,
        connectionId: fact.data.connectionId,
        organizationId: fact.data.organizationId,
        state: "TOKEN_ISSUED",
        createdAtMs: state.createdAtMs === 0 ? fact.occurredAt : state.createdAtMs,
      };
    case SCIM_USER_PUSHED_EVENT_TYPE:
    case SCIM_GROUP_MAPPED_EVENT_TYPE:
      // A push that lands is what clears an error: the connection is working
      // again, and the failure it recovered from stays in `deadLetters` only
      // if it was retired there.
      return {
        ...touched,
        connectionId: fact.data.connectionId,
        organizationId: fact.data.organizationId,
        state: "SYNCING",
        lastPushedAtMs: fact.occurredAt,
        lastFailure: null,
      };
    case SCIM_APPLY_FAILED_EVENT_TYPE:
      return {
        ...touched,
        connectionId: fact.data.connectionId,
        organizationId: fact.data.organizationId,
        state: "ERROR",
        lastFailure: {
          op: fact.data.op,
          errorCode: fact.data.errorCode,
          attempts: sameFailure(state.lastFailure, fact.data)
            ? state.lastFailure.attempts + 1
            : 1,
          retiredAtMs: null,
          redrivenAtMs: null,
          userId: fact.data.userId,
          occurredAtMs: fact.occurredAt,
        },
      };
    case SCIM_APPLY_RECOVERED_EVENT_TYPE:
      return { ...touched, state: "SYNCING", lastFailure: null };
    case SCIM_APPLY_RETIRED_EVENT_TYPE: {
      const retired: ScimSyncFailure = {
        op: fact.data.op,
        errorCode: fact.data.errorCode,
        attempts: fact.data.attempts,
        retiredAtMs: fact.occurredAt,
        redrivenAtMs: null,
        userId: fact.data.userId,
        occurredAtMs: fact.occurredAt,
      };
      // Stays in ERROR: a retired apply is a state the directory asked for
      // and did not get, so the connection is not healthy just because we
      // stopped trying.
      return {
        ...touched,
        state: "ERROR",
        lastFailure: retired,
        deadLetters: [...state.deadLetters, retired],
      };
    }
    case SCIM_APPLY_REDRIVEN_EVENT_TYPE: {
      // Stamps the ONE dead letter the operator named, and leaves the sync
      // where it is. A re-drive is a request, not an outcome: what the apply
      // then does states its own fact, and moving the connection to SYNCING
      // here would report a directory as healthy on the strength of somebody
      // having tried.
      const stamp = (failure: ScimSyncFailure): ScimSyncFailure =>
        failure.retiredAtMs === fact.data.retiredAtMs &&
        failure.redrivenAtMs === null
          ? { ...failure, redrivenAtMs: fact.occurredAt }
          : failure;
      return {
        ...touched,
        lastFailure: state.lastFailure ? stamp(state.lastFailure) : null,
        deadLetters: state.deadLetters.map(stamp),
      };
    }
    case SCIM_TOKEN_REVOKED_EVENT_TYPE:
      return {
        ...touched,
        connectionId: fact.data.connectionId,
        organizationId: fact.data.organizationId,
        state: "REVOKED",
        revokedCause: fact.data.cause,
      };
  }
}

/**
 * Whether a new failure continues the one already standing, which is what
 * makes `attempts` a retry count rather than a total. Same operation, same
 * reason, same person: the identity provider is retrying, not failing at
 * something new.
 */
function sameFailure(
  standing: ScimSyncFailure | null,
  next: { op: ScimApplyOp; errorCode: string; userId: string | null },
): standing is ScimSyncFailure {
  return (
    standing !== null &&
    standing.retiredAtMs === null &&
    standing.op === next.op &&
    standing.errorCode === next.errorCode &&
    standing.userId === next.userId
  );
}
