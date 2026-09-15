// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What the SCIM boundary tells the directory-sync history (D08).
 *
 * The SCIM services do the protocol work; this states what happened as facts
 * on the connection's `ScimSync` aggregate. Kept separate from them for the
 * reason every ledger seam in this codebase is: a service that both applies a
 * change and writes its own history has two reasons to change, and the second
 * one quietly acquires the first one's failure modes.
 *
 * Three things this owns and nothing else does:
 *
 *   THE ACTOR      one directory principal, `system:scim`, on every
 *                  connection. Not the connection id — `SYSTEM_ACTORS` is a
 *                  closed registry and a connection id is a per-customer
 *                  value. WHICH connection pushed lives on the fact.
 *
 *   THE COMMAND ID minted fresh per call, because a directory legitimately
 *                  re-pushes the same state every night and those are
 *                  different facts. Idempotency here is the GUARD's job
 *                  (a state that already says this states nothing), not the
 *                  command id's.
 *
 *   WHAT IS SAFE   only ids, reason CODES and the directory's own external
 *                  identifiers ever reach a fact. No token, no email, no
 *                  provider prose.
 *
 * See specs/identity/scim-connection-sync.feature.
 */
import { SYSTEM_ACTORS } from "@langwatch/actor";
import {
  ISSUE_SCIM_TOKEN_COMMAND_TYPE,
  RECORD_SCIM_APPLY_FAILURE_COMMAND_TYPE,
  RECORD_SCIM_GROUP_MAPPING_COMMAND_TYPE,
  RECORD_SCIM_USER_PUSH_COMMAND_TYPE,
  REDRIVE_SCIM_APPLY_COMMAND_TYPE,
  REVOKE_SCIM_SYNC_COMMAND_TYPE,
  type ScimApplyOp,
  type ScimRevokeCause,
  type ScimSyncCommand,
  type ScimSyncFactInput,
  type ScimUserOp,
  scimSyncIdFor,
} from "@langwatch/identity";
import {
  newScimSyncCommandId,
  type ScimSyncGuards,
  type ScimSyncLedger,
} from "@langwatch/identity-server";

/**
 * The durable record's actor. One principal for every connection an
 * organization has — see the class docblock, and
 * `platform/app/ee/scim/scim.service.ts` for the same note where the
 * membership facts are stamped.
 */
const SCIM_SYNC_ACTOR = { type: "system", id: SYSTEM_ACTORS.scim } as const;

export interface ScimSyncLifecycleDeps {
  guards: ScimSyncGuards;
  ledger: ScimSyncLedger;
  /** Injectable for tests; production mints a KSUID per call. */
  newCommandId?: () => string;
  /** Injectable for tests; production reads the wall clock. */
  now?: () => number;
}

export class ScimSyncLifecycle {
  private readonly guards: ScimSyncGuards;
  private readonly ledger: ScimSyncLedger;
  private readonly newCommandId: () => string;
  private readonly now: () => number;

  constructor(deps: ScimSyncLifecycleDeps) {
    this.guards = deps.guards;
    this.ledger = deps.ledger;
    this.newCommandId = deps.newCommandId ?? newScimSyncCommandId;
    this.now = deps.now ?? (() => Date.now());
  }

  /** A token was minted for this connection: its sync begins. */
  async tokenIssued({
    organizationId,
    connectionId,
    tokenId,
  }: {
    organizationId: string;
    connectionId: string;
    tokenId: string;
  }): Promise<void> {
    const data = {
      ...this.identity({ organizationId, connectionId }),
      tokenId,
    };
    await this.commit(
      { type: ISSUE_SCIM_TOKEN_COMMAND_TYPE, data },
      await this.guards.issueScimToken(data),
    );
  }

  /** A push changed one person. */
  async userPushed({
    organizationId,
    connectionId,
    userId,
    externalId,
    op,
  }: {
    organizationId: string;
    connectionId: string;
    userId: string;
    externalId: string;
    op: ScimUserOp;
  }): Promise<void> {
    const data = {
      ...this.identity({ organizationId, connectionId }),
      userId,
      externalId,
      op,
    };
    await this.commit(
      { type: RECORD_SCIM_USER_PUSH_COMMAND_TYPE, data },
      await this.guards.recordScimUserPush(data),
    );
  }

  /** A directory group arrived from this connection. */
  async groupMapped({
    organizationId,
    connectionId,
    groupId,
    externalId,
  }: {
    organizationId: string;
    connectionId: string;
    groupId: string;
    externalId: string | null;
  }): Promise<void> {
    const data = {
      ...this.identity({ organizationId, connectionId }),
      groupId,
      externalId,
    };
    await this.commit(
      { type: RECORD_SCIM_GROUP_MAPPING_COMMAND_TYPE, data },
      await this.guards.recordScimGroupMapping(data),
    );
  }

  /**
   * An apply failed. The guard decides whether this attempt also retires the
   * failure into a dead letter; the caller only says what went wrong and
   * whether another attempt could plausibly work.
   */
  async applyFailed({
    organizationId,
    connectionId,
    op,
    errorCode,
    retryable,
    userId = null,
  }: {
    organizationId: string;
    connectionId: string;
    op: ScimApplyOp;
    errorCode: string;
    retryable: boolean;
    userId?: string | null;
  }): Promise<void> {
    const data = {
      ...this.identity({ organizationId, connectionId }),
      op,
      errorCode,
      retryable,
      userId,
    };
    await this.commit(
      { type: RECORD_SCIM_APPLY_FAILURE_COMMAND_TYPE, data },
      await this.guards.recordScimApplyFailure(data),
    );
  }

  /**
   * A platform operator sent a retired apply through again (ADR-122).
   *
   * The one verb here whose actor is NOT the directory. It is stamped with
   * the operator because a re-drive is authority exercised across a tenant
   * boundary, and the tenant's own history is where that has to be readable —
   * an audit row only support can see would not be.
   */
  async applyRedriven({
    organizationId,
    connectionId,
    retiredAtMs,
    operator,
  }: {
    organizationId: string;
    connectionId: string;
    retiredAtMs: number;
    operator: { userId: string };
  }): Promise<void> {
    const data = {
      ...this.identity({ organizationId, connectionId }),
      actor: { type: "user", id: operator.userId } as const,
      retiredAtMs,
    };
    await this.commit(
      { type: REDRIVE_SCIM_APPLY_COMMAND_TYPE, data },
      await this.guards.redriveScimApply(data),
    );
  }

  /** The sync ends: its token was revoked, or its connection torn down. */
  async revoked({
    organizationId,
    connectionId,
    tokenId,
    cause,
  }: {
    organizationId: string;
    connectionId: string;
    tokenId: string | null;
    cause: ScimRevokeCause;
  }): Promise<void> {
    const data = {
      ...this.identity({ organizationId, connectionId }),
      tokenId,
      cause,
    };
    await this.commit(
      { type: REVOKE_SCIM_SYNC_COMMAND_TYPE, data },
      await this.guards.revokeScimSync(data),
    );
  }

  /**
   * The block every command carries. `tenantId === organizationId` is the
   * command schemas' own invariant — one directory-sync history per
   * organization — and building it here is what keeps a caller from wiring
   * the two apart.
   */
  private identity({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }) {
    return {
      tenantId: organizationId,
      organizationId,
      scimSyncId: scimSyncIdFor({ connectionId }),
      connectionId,
      commandId: this.newCommandId(),
      occurredAtMs: this.now(),
      actor: SCIM_SYNC_ACTOR,
    };
  }

  private async commit(
    command: ScimSyncCommand,
    facts: ScimSyncFactInput[],
  ): Promise<void> {
    if (facts.length === 0) return;
    await this.ledger.commit({ command, facts });
  }
}
