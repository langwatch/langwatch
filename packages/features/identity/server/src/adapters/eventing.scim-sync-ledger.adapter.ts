/**
 * The directory-sync ledger writer:
 * grants, connection and join-request ledgers already have (ADR-110):
 * and stage afterwards, ADR-101's original order, which ADR-110 corrected for
 */
import {
  ISSUE_SCIM_TOKEN_COMMAND_TYPE,
  RECORD_SCIM_APPLY_FAILURE_COMMAND_TYPE,
  RECORD_SCIM_GROUP_MAPPING_COMMAND_TYPE,
  RECORD_SCIM_USER_PUSH_COMMAND_TYPE,
  REVOKE_SCIM_SYNC_COMMAND_TYPE,
  type ScimSyncCommand,
  type ScimSyncCommandType,
  type ScimSyncFactInput,
} from "@langwatch/identity-contract";
import type { ScimSyncLedger } from "../rules/scim-sync-ledger.rules";
import type { IdentityEventingPort } from "../ports/identity-eventing.port";
import { createLogger } from "@langwatch/observability";
import { SCIM_SYNC_PIPELINE_NAME } from "@langwatch/identity-contract";

const logger = createLogger("langwatch:identity:scim-sync-ledger");

export type ScimSyncStagedSender = {
  send(data: unknown): Promise<unknown>;
};

const SENDER_NAME_BY_COMMAND: Record<ScimSyncCommandType, string> = {
  [ISSUE_SCIM_TOKEN_COMMAND_TYPE]: "issueScimToken",
  [RECORD_SCIM_USER_PUSH_COMMAND_TYPE]: "recordScimUserPush",
  [RECORD_SCIM_GROUP_MAPPING_COMMAND_TYPE]: "recordScimGroupMapping",
  [RECORD_SCIM_APPLY_FAILURE_COMMAND_TYPE]: "recordScimApplyFailure",
  [REVOKE_SCIM_SYNC_COMMAND_TYPE]: "revokeScimSync",
};

export interface ScimSyncLedgerWriterDeps {
  /**
   * The process's event stack. The command handle is resolved per call and may
   * be absent: a deployment can run with the stack disabled, and the ledger
   * says so rather than refusing the directory's push.
   */
  eventing: IdentityEventingPort;
}

export class ScimSyncLedgerWriterAdapter implements ScimSyncLedger {
  private readonly eventing: IdentityEventingPort;

  static create(deps: ScimSyncLedgerWriterDeps): ScimSyncLedgerWriterAdapter {
    return new ScimSyncLedgerWriterAdapter(deps);
  }

  constructor(deps: ScimSyncLedgerWriterDeps) {
    this.eventing = deps.eventing;
  }

  private stagedSender(name: string): Promise<ScimSyncStagedSender | null> {
    return this.eventing.tryPipelineCommand({
      pipeline: SCIM_SYNC_PIPELINE_NAME,
      command: name,
    });
  }

  async commit({
    command,
    facts,
  }: {
    command: ScimSyncCommand;
    facts: ScimSyncFactInput[];
  }): Promise<void> {
    // A guard that stated nothing has nothing to stage. The envelope itself is
    // the queued run's to stamp now that it is the sole appender, so this asks
    // the facts rather than building events it would only count.
    if (facts.length === 0) return;
    const { scimSyncId, connectionId } = command.data;

    try {
      await this.stage({ command, scimSyncId, connectionId });
    } catch (error) {
      // Swallowed on purpose, and loudly. The membership consequence this is
      // the bookkeeping for has already landed through the grants ledger; the
      // fact that this history is behind is an operational problem for us,
      // never a reason to refuse the identity provider's push.
      logger.error(
        { scimSyncId, connectionId, commandType: command.type, error },
        "could not record a directory sync fact; the push itself is unaffected",
      );
    }
  }

  /**
   * The command handed to the queue, which is where the append happens.
   */
  private async stage({
    command,
    scimSyncId,
    connectionId,
  }: {
    command: ScimSyncCommand;
    scimSyncId: string;
    connectionId: string;
  }): Promise<void> {
    const senderName = SENDER_NAME_BY_COMMAND[command.type];
    const sender = await this.stagedSender(senderName);
    if (!sender) {
      logger.error(
        {
          scimSyncId,
          connectionId,
          commandType: command.type,
          pipeline: SCIM_SYNC_PIPELINE_NAME,
          senderName,
        },
        `directory sync history not recorded: this process registered no "${SCIM_SYNC_PIPELINE_NAME}" pipeline, so there is no "${senderName}" sender to stage through. The push itself is unaffected; every directory-sync fact is lost until the pipeline is registered on this process's eventing.`,
      );
      return;
    }
    await sender.send(command.data);
  }
}
