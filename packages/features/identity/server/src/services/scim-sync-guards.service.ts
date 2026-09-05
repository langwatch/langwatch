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
} from "@langwatch/identity-contract";
import type { ScimSyncReadRepository } from "../repositories/scim-sync.repository";

/**
 * The directory-sync guards (D08): what runs BEFORE any sync fact exists. Each verb reads the
 * sync's FOLDED STATE and states only what the state does not already carry.
 */

/**
 * How many identical failed applies an identity provider may make before the failure is retired
 * as a dead letter.
 */
export const SCIM_APPLY_MAX_ATTEMPTS = 5;

export class ScimSyncGuardsService {
  static create(deps: { syncs: ScimSyncReadRepository }): ScimSyncGuardsService {
    return new ScimSyncGuardsService(deps);
  }

  private constructor(private readonly deps: { syncs: ScimSyncReadRepository }) {}

  /**
   * A token was minted for this connection. Idempotent by state: a second
   * token for a connection already syncing states nothing, because the sync
   * is what the fact is about and it already exists.
   */
  async issueScimToken(data: IssueScimTokenCommandData): Promise<ScimSyncFactInput[]> {
    const state = await this.load(data);
    if (state && state.state !== "REVOKED") {
      return [];
    }

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

  async recordScimUserPush(data: RecordScimUserPushCommandData): Promise<ScimSyncFactInput[]> {
    const state = await this.load(data);
    if (state?.state === "REVOKED") {
      return [];
    }

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
    if (state?.state === "REVOKED") {
      return [];
    }

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
   * An apply failed. Always states the failure; states the retirement WITH it when this attempt
   * is the last one, so the dead letter and the failure that produced it land in one append
   * rather than needing a second command that a crash could lose.
   */
  async recordScimApplyFailure(
    data: RecordScimApplyFailureCommandData,
  ): Promise<ScimSyncFactInput[]> {
    const state = await this.load(data);
    if (state?.state === "REVOKED") {
      return [];
    }

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
  async revokeScimSync(data: RevokeScimSyncCommandData): Promise<ScimSyncFactInput[]> {
    const state = await this.load(data);
    if (state?.state === "REVOKED") {
      return [];
    }

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
    return this.deps.syncs.tryFindSync({ scimSyncId, organizationId });
  }

  /** The recovery fact, when there is a standing failure for a push to end. */
  private recoveryOf(state: ScimSyncState | null): ScimSyncFactInput[] {
    if (!state || state.state !== "ERROR" || !state.lastFailure) {
      return [];
    }

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
   * What the attempt count becomes once this failure lands. Mirrors the reducer's own
   * continuation rule — same operation, same reason, same person, not already retired — so the
   * number the retirement fact carries is the number the projection will hold.
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
