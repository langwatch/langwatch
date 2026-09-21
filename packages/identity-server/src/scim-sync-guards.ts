import {
  type IssueScimTokenCommandData,
  type RecordScimApplyFailureCommandData,
  type RecordScimGroupMappingCommandData,
  type RecordScimUserPushCommandData,
  type RevokeScimSyncCommandData,
  SCIM_APPLY_FAILED_EVENT_TYPE,
  SCIM_APPLY_RECOVERED_EVENT_TYPE,
  SCIM_APPLY_RETIRED_EVENT_TYPE,
  SCIM_GROUP_MAPPED_EVENT_TYPE,
  SCIM_TOKEN_ISSUED_EVENT_TYPE,
  SCIM_TOKEN_REVOKED_EVENT_TYPE,
  SCIM_USER_PUSHED_EVENT_TYPE,
  type ScimSyncFactInput,
  type ScimSyncState,
} from "@langwatch/identity";
import type { ScimSyncReadRepository } from "./scim-sync.repository";

/**
 * The directory-sync guards (D08): what runs BEFORE any sync fact exists.
 * Each verb reads the sync's FOLDED STATE and states only what the state does
 * not already carry.
 *
 * One implementation, two callers — the SCIM boundary on the calling path and
 * the pipeline's command handlers on the staged re-run — so a retried command
 * re-derives the same facts rather than a second set.
 *
 * Two decisions live here and nowhere else:
 *
 *   RECOVERY   a push that lands while the sync is in ERROR states the
 *              recovery as its own fact, so "it started working again"
 *              appears in the same history the failure did rather than being
 *              inferred from an absence.
 *
 *   RETIREMENT a failure is retired — becomes a dead letter — when it can
 *              never succeed, or when the identity provider has retried the
 *              identical failure {@link SCIM_APPLY_MAX_ATTEMPTS} times. It is
 *              retired VISIBLY: the fact stays, the sync stays in ERROR, and
 *              the directory's requested state is never reported as reached.
 *
 * A sync that is REVOKED states nothing at all. Its token has stopped
 * verifying, so a command reaching here is a straggler from before the
 * teardown, and folding it would report a torn-down connection as healthy.
 *
 * Facts come back without their envelope; the ledger stamps business time,
 * tenancy and idempotency from the command that produced them.
 */

/**
 * How many identical failed applies an identity provider may make before the
 * failure is retired as a dead letter.
 *
 * Five, because a directory retries on its own schedule — hourly for most,
 * nightly for some — and the number has to be large enough that a transient
 * outage recovers on its own and small enough that a genuinely stuck
 * deprovision reaches an administrator the same working day. It is a count of
 * IDENTICAL failures (same operation, same reason, same person), so a
 * connection failing at several different things does not retire any of them
 * early.
 */
export const SCIM_APPLY_MAX_ATTEMPTS = 5;

export class ScimSyncGuards {
  constructor(private readonly deps: { syncs: ScimSyncReadRepository }) {}

  /**
   * A token was minted for this connection. Idempotent by state: a second
   * token for a connection already syncing states nothing, because the sync
   * is what the fact is about and it already exists.
   */
  async issueScimToken(
    data: IssueScimTokenCommandData,
  ): Promise<ScimSyncFactInput[]> {
    const state = await this.load(data);
    if (state && state.state !== "REVOKED") return [];
    return [
      {
        type: SCIM_TOKEN_ISSUED_EVENT_TYPE,
        data: {
          scimSyncId: data.scimSyncId,
          connectionId: data.connectionId,
          organizationId: data.organizationId,
          tokenId: data.tokenId,
          actor: data.actor,
        },
      },
    ];
  }

  async recordScimUserPush(
    data: RecordScimUserPushCommandData,
  ): Promise<ScimSyncFactInput[]> {
    const state = await this.load(data);
    if (state?.state === "REVOKED") return [];
    return [
      {
        type: SCIM_USER_PUSHED_EVENT_TYPE,
        data: {
          scimSyncId: data.scimSyncId,
          connectionId: data.connectionId,
          organizationId: data.organizationId,
          userId: data.userId,
          externalId: data.externalId,
          op: data.op,
        },
      },
      ...this.recoveryOf(state),
    ];
  }

  async recordScimGroupMapping(
    data: RecordScimGroupMappingCommandData,
  ): Promise<ScimSyncFactInput[]> {
    const state = await this.load(data);
    if (state?.state === "REVOKED") return [];
    return [
      {
        type: SCIM_GROUP_MAPPED_EVENT_TYPE,
        data: {
          scimSyncId: data.scimSyncId,
          connectionId: data.connectionId,
          organizationId: data.organizationId,
          groupId: data.groupId,
          externalId: data.externalId,
        },
      },
      ...this.recoveryOf(state),
    ];
  }

  /**
   * An apply failed. Always states the failure; states the retirement WITH
   * it when this attempt is the last one, so the dead letter and the failure
   * that produced it land in one append rather than needing a second command
   * that a crash could lose.
   */
  async recordScimApplyFailure(
    data: RecordScimApplyFailureCommandData,
  ): Promise<ScimSyncFactInput[]> {
    const state = await this.load(data);
    if (state?.state === "REVOKED") return [];

    const identity = {
      scimSyncId: data.scimSyncId,
      connectionId: data.connectionId,
      organizationId: data.organizationId,
    };
    const attempts = this.attemptsAfter({ state, data });
    const facts: ScimSyncFactInput[] = [
      {
        type: SCIM_APPLY_FAILED_EVENT_TYPE,
        data: {
          ...identity,
          op: data.op,
          errorCode: data.errorCode,
          retryable: data.retryable,
          userId: data.userId,
        },
      },
    ];
    if (!data.retryable || attempts >= SCIM_APPLY_MAX_ATTEMPTS) {
      facts.push({
        type: SCIM_APPLY_RETIRED_EVENT_TYPE,
        data: {
          ...identity,
          op: data.op,
          errorCode: data.errorCode,
          attempts,
          userId: data.userId,
        },
      });
    }
    return facts;
  }

  /** The connection's sync ends. Idempotent: a second revoke states nothing. */
  async revokeScimSync(
    data: RevokeScimSyncCommandData,
  ): Promise<ScimSyncFactInput[]> {
    const state = await this.load(data);
    if (state?.state === "REVOKED") return [];
    return [
      {
        type: SCIM_TOKEN_REVOKED_EVENT_TYPE,
        data: {
          scimSyncId: data.scimSyncId,
          connectionId: data.connectionId,
          organizationId: data.organizationId,
          tokenId: data.tokenId,
          cause: data.cause,
        },
      },
    ];
  }

  private load({
    scimSyncId,
    organizationId,
  }: {
    scimSyncId: string;
    organizationId: string;
  }): Promise<ScimSyncState | null> {
    return this.deps.syncs.findSync({ scimSyncId, organizationId });
  }

  /** The recovery fact, when there is a standing failure for a push to end. */
  private recoveryOf(state: ScimSyncState | null): ScimSyncFactInput[] {
    if (!state || state.state !== "ERROR" || !state.lastFailure) return [];
    return [
      {
        type: SCIM_APPLY_RECOVERED_EVENT_TYPE,
        data: {
          scimSyncId: state.scimSyncId,
          connectionId: state.connectionId,
          organizationId: state.organizationId,
          op: state.lastFailure.op,
        },
      },
    ];
  }

  /**
   * What the attempt count becomes once this failure lands. Mirrors the
   * reducer's own continuation rule — same operation, same reason, same
   * person, not already retired — so the number the retirement fact carries
   * is the number the projection will hold.
   */
  private attemptsAfter({
    state,
    data,
  }: {
    state: ScimSyncState | null;
    data: RecordScimApplyFailureCommandData;
  }): number {
    const standing = state?.lastFailure;
    const continues =
      standing != null &&
      standing.retiredAtMs === null &&
      standing.op === data.op &&
      standing.errorCode === data.errorCode &&
      standing.userId === data.userId;
    return continues ? standing.attempts + 1 : 1;
  }
}
