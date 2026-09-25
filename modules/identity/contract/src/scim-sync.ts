/** Directory sync aggregate: one per SSO connection, recording pushes and lifecycle. Audit history
 * only; membership consequences dispatch to the grants ledger. See D08.
 */
import { z } from "zod";

import { identityActorSchema } from "./vocabulary.ts";

export const SCIM_SYNC_EVENT_VERSION_LATEST = "2026-08-24" as const;

// ---- lifecycle -----------------------------------------------------------

/**
 * Where a connection's directory sync stands. `TOKEN_ISSUED` ("wired but
 * never used") is worth telling apart from `SYNCING` — a stalled setup looks
 * nothing like a working one.
 */
export const SCIM_SYNC_STATES = ["TOKEN_ISSUED", "SYNCING", "ERROR", "REVOKED"] as const;
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
export const SCIM_APPLY_OPS = ["push_user", "deactivate_user", "delete_user", "map_group"] as const;
export const scimApplyOpSchema = z.enum(SCIM_APPLY_OPS);
export type ScimApplyOp = z.infer<typeof scimApplyOpSchema>;

/** Why a sync ended. Both end the same way; only the cause differs. */
export const SCIM_REVOKE_CAUSES = ["revoke", "teardown"] as const;
export const scimRevokeCauseSchema = z.enum(SCIM_REVOKE_CAUSES);
export type ScimRevokeCause = z.infer<typeof scimRevokeCauseSchema>;

// ---- events --------------------------------------------------------------

export const SCIM_TOKEN_ISSUED_EVENT_TYPE = "lw.identity.scim_token_issued" as const;
export const SCIM_USER_PUSHED_EVENT_TYPE = "lw.identity.scim_user_pushed" as const;
export const SCIM_GROUP_MAPPED_EVENT_TYPE = "lw.identity.scim_group_mapped" as const;
export const SCIM_APPLY_FAILED_EVENT_TYPE = "lw.identity.scim_apply_failed" as const;
export const SCIM_APPLY_RECOVERED_EVENT_TYPE = "lw.identity.scim_apply_recovered" as const;
export const SCIM_APPLY_RETIRED_EVENT_TYPE = "lw.identity.scim_apply_retired" as const;
export const SCIM_TOKEN_REVOKED_EVENT_TYPE = "lw.identity.scim_token_revoked" as const;
export const SCIM_APPLY_REDRIVEN_EVENT_TYPE = "lw.identity.scim_apply_redriven" as const;

export const SCIM_SYNC_EVENT_TYPES = [
  SCIM_TOKEN_ISSUED_EVENT_TYPE,
  SCIM_USER_PUSHED_EVENT_TYPE,
  SCIM_GROUP_MAPPED_EVENT_TYPE,
  SCIM_APPLY_FAILED_EVENT_TYPE,
  SCIM_APPLY_RECOVERED_EVENT_TYPE,
  SCIM_APPLY_RETIRED_EVENT_TYPE,
  SCIM_TOKEN_REVOKED_EVENT_TYPE,
  SCIM_APPLY_REDRIVEN_EVENT_TYPE,
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
 * The operator surface's one write (ADR-122): a retired apply sent through
 * again. Names WHICH dead letter by its retirement time; the operator rides
 * on the fact because a re-drive crosses a tenant boundary.
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
 * The last thing that went wrong, as the failure surface reads it. Names the
 * connection, operation and reason code — never a token, secret, or hostname.
 */
export const scimSyncFailureSchema = z.object({
  op: scimApplyOpSchema,
  errorCode: z.string(),
  /** How many failed applies have accumulated since the last recovery. */
  attempts: z.number().int().nonnegative(),
  /** Set once the failure is retired: it will not be retried again. */
  retiredAtMs: z.number().nullable(),
  /** The person it was about, when it was about one. */
  userId: z.string().nullable(),
  occurredAtMs: z.number(),
  /** Set once an operator re-drove the retired apply (ADR-122); rows before it carry none. */
  redrivenAtMs: z.number().nullable().default(null),
});
export type ScimSyncFailure = z.infer<typeof scimSyncFailureSchema>;

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

/** The sync's aggregate id, derived from the connection id. A connection has exactly one sync:
 * deriving the id avoids a lookup table and ensures no sync escapes the connection.
 */
export function scimSyncIdFor({ connectionId }: { connectionId: string }): string {
  return connectionId;
}

/**
 * The dead letter a re-drive names, when it may still be re-driven: retired at
 * that time and not re-driven yet. The guard and the operator surface ask the
 * same question, so one predicate answers both.
 */
export function pickRetiredLetter({
  state,
  retiredAtMs,
}: {
  state: ScimSyncState;
  retiredAtMs: number;
}): ScimSyncFailure | undefined {
  return state.deadLetters.find(
    (failure) => failure.retiredAtMs === retiredAtMs && failure.redrivenAtMs === null,
  );
}

export function emptyScimSync({ scimSyncId }: { scimSyncId: string }): ScimSyncState {
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

/** Pure and total reducer: every fact answers a next state, runs identically in fold, replay proof,
 * and browser. REVOKED is terminal and absorbing.
 */
export function reduceScimSync({
  state,
  fact,
}: {
  state: ScimSyncState;
  fact: ScimSyncFact;
}): ScimSyncState {
  const touched = { ...state, updatedAtMs: fact.occurredAt };
  // REVOKED absorbs everything the DIRECTORY does: a push arriving after a
  // revocation comes from a token that should already have stopped verifying.
  // Issuing a new token is not something the directory does - it is the exact
  // advice we give when one leaks, and absorbing it made that advice a trap.
  if (state.state === "REVOKED" && fact.type !== SCIM_TOKEN_ISSUED_EVENT_TYPE) {
    return touched;
  }

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
          attempts: sameFailure(state.lastFailure, fact.data) ? state.lastFailure.attempts + 1 : 1,
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
        userId: fact.data.userId,
        occurredAtMs: fact.occurredAt,
        redrivenAtMs: null,
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
      // Stamps the ONE dead letter named and leaves the sync where it is: a
      // re-drive is a request, and what the apply then does states its own fact.
      const stamp = (failure: ScimSyncFailure): ScimSyncFailure =>
        failure.retiredAtMs === fact.data.retiredAtMs && failure.redrivenAtMs === null
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
 * Whether a new failure continues the one already standing — same operation,
 * reason and person — which is what makes `attempts` a retry count, not a
 * total.
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
