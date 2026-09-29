// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The directory-sync ledger writer (ADR-110): the command is staged onto the
 * per-sync queue, whose run is the sole appender. The senders are scim's own,
 * handed over when the process connects the scim-sync pipeline.
 */
import {
  ISSUE_SCIM_TOKEN_COMMAND_TYPE,
  RECORD_SCIM_APPLY_FAILURE_COMMAND_TYPE,
  RECORD_SCIM_GROUP_MAPPING_COMMAND_TYPE,
  RECORD_SCIM_USER_PUSH_COMMAND_TYPE,
  REDRIVE_SCIM_APPLY_COMMAND_TYPE,
  REVOKE_SCIM_SYNC_COMMAND_TYPE,
  type IssueScimTokenCommandData,
  type RecordScimApplyFailureCommandData,
  type RecordScimGroupMappingCommandData,
  type RecordScimUserPushCommandData,
  type RedriveScimApplyCommandData,
  type RevokeScimSyncCommandData,
  type ScimSyncCommand,
  type ScimSyncCommandType,
  type ScimSyncFactInput,
  SCIM_SYNC_PIPELINE_NAME,
} from "@langwatch/enterprise-scim-contract";
import type { EventingCommandSender } from "@langwatch/eventing";
import { createLogger, type Logger } from "@langwatch/observability";

import type { ScimSyncLifecycleLedger } from "./scim-sync-lifecycle.service.ts";

type Sender<Data> = Pick<EventingCommandSender<Data>, "send">;

/** The scim-sync pipeline's six senders, by verb. */
export type ScimSyncSenders = Readonly<{
  issueScimToken: Sender<IssueScimTokenCommandData>;
  recordScimUserPush: Sender<RecordScimUserPushCommandData>;
  recordScimGroupMapping: Sender<RecordScimGroupMappingCommandData>;
  recordScimApplyFailure: Sender<RecordScimApplyFailureCommandData>;
  redriveScimApply: Sender<RedriveScimApplyCommandData>;
  revokeScimSync: Sender<RevokeScimSyncCommandData>;
}>;

interface ScimSyncLedgerWriterDeps {
  /** Defaults to the module's own logger; a test injects a captured one. */
  logger?: Logger;
}

export class ScimSyncLedgerWriterService implements ScimSyncLifecycleLedger {
  private readonly logger: Logger;
  #senders: ScimSyncSenders | undefined;

  static create(deps: ScimSyncLedgerWriterDeps = {}): ScimSyncLedgerWriterService {
    return new ScimSyncLedgerWriterService(deps);
  }

  private constructor(deps: ScimSyncLedgerWriterDeps) {
    this.logger = deps.logger ?? createLogger("langwatch:scim:scim-sync-ledger");
  }

  /** The registered pipeline's senders; a process that registered none never calls this. */
  connect(senders: ScimSyncSenders): void {
    // A runtime with no command queue hands over no senders at all: nothing is commandable here.
    if (Object.keys(senders).length === 0) return;
    this.#senders = senders;
  }

  async commit({
    command,
    facts,
  }: {
    command: ScimSyncCommand;
    facts: ScimSyncFactInput[];
  }): Promise<void> {
    // A guard that stated nothing has nothing to stage.
    if (facts.length === 0) return;
    const { scimSyncId, connectionId } = command.data;

    try {
      await this.stage({ command, scimSyncId, connectionId });
    } catch (error) {
      // Swallowed on purpose, and loudly: the membership change already landed through the
      // grants ledger, so a history that is behind never refuses the identity provider's push.
      this.logger.error(
        { scimSyncId, connectionId, commandType: command.type, error },
        "could not record a directory sync fact; the push itself is unaffected",
      );
    }
  }

  private async stage({
    command,
    scimSyncId,
    connectionId,
  }: {
    command: ScimSyncCommand;
    scimSyncId: string;
    connectionId: string;
  }): Promise<void> {
    const senders = this.#senders;
    if (!senders) {
      const senderName = SENDER_NAME_BY_COMMAND[command.type];
      this.logger.error(
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
    await sendThrough({ senders, command });
  }
}

const SENDER_NAME_BY_COMMAND: Record<ScimSyncCommandType, keyof ScimSyncSenders> = {
  [ISSUE_SCIM_TOKEN_COMMAND_TYPE]: "issueScimToken",
  [RECORD_SCIM_USER_PUSH_COMMAND_TYPE]: "recordScimUserPush",
  [RECORD_SCIM_GROUP_MAPPING_COMMAND_TYPE]: "recordScimGroupMapping",
  [RECORD_SCIM_APPLY_FAILURE_COMMAND_TYPE]: "recordScimApplyFailure",
  [REDRIVE_SCIM_APPLY_COMMAND_TYPE]: "redriveScimApply",
  [REVOKE_SCIM_SYNC_COMMAND_TYPE]: "revokeScimSync",
};

/** One command onto the sender for its own verb, typed by the command's discriminant. */
async function sendThrough({
  senders,
  command,
}: {
  senders: ScimSyncSenders;
  command: ScimSyncCommand;
}): Promise<void> {
  switch (command.type) {
    case ISSUE_SCIM_TOKEN_COMMAND_TYPE:
      await senders.issueScimToken.send(command.data);
      return;
    case RECORD_SCIM_USER_PUSH_COMMAND_TYPE:
      await senders.recordScimUserPush.send(command.data);
      return;
    case RECORD_SCIM_GROUP_MAPPING_COMMAND_TYPE:
      await senders.recordScimGroupMapping.send(command.data);
      return;
    case RECORD_SCIM_APPLY_FAILURE_COMMAND_TYPE:
      await senders.recordScimApplyFailure.send(command.data);
      return;
    case REDRIVE_SCIM_APPLY_COMMAND_TYPE:
      await senders.redriveScimApply.send(command.data);
      return;
    case REVOKE_SCIM_SYNC_COMMAND_TYPE:
      await senders.revokeScimSync.send(command.data);
      return;
  }
}
