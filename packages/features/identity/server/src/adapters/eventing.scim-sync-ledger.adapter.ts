/**
 * The directory-sync ledger writer: the app's implementation of
 * `@langwatch/identity-server`'s ScimSyncLedger, in the shape the identity,
 * grants, connection and join-request ledgers already have (ADR-110):
 *
 *   1. the command staged onto the per-sync GroupQueue — the queued run is what
 *      APPENDS, re-running the same guard the calling path ran.
 *
 * That is the whole of it. This writer used to append to the durable log here
 * and stage afterwards, ADR-101's original order, which ADR-110 corrected for
 * every sibling: the queued run re-executes `guards[verb]` and states the same
 * facts, so appending on the calling path writes each one twice. It also could
 * not work where it runs — the tier a directory's push arrives at is a
 * producer, whose event store refuses `storeEvents` by name — so the append
 * was a guaranteed failure that took the whole history down with it.
 *
 * NO read-your-writes wait, unlike the connection ledger. Nothing on the SCIM
 * request path reads this projection back: the endpoints answer from Postgres
 * exactly as they did before, and holding an identity provider's HTTP request
 * open while a fold converged would buy an unread row at the cost of the one
 * property the protocol surface has to keep — answering as it always did.
 *
 * A push must never fail because its HISTORY could not be written. What the
 * customer is owed is the membership consequence, which travels the grants
 * ledger and is already durable by the time this runs; a sync fact that
 * cannot land is logged and swallowed. The opposite choice — refusing a push
 * whose bookkeeping failed — would turn an event-stack blip into a directory
 * outage.
 *
 * The swallow is LOUD and NAMES THE MISSING PIECE. A process that composes
 * this writer without registering the `scim-sync` pipeline on its own eventing
 * has no sender to stage through, and then every push's history is lost for as
 * long as that is true — permanently, not transiently. The log line says which
 * registration is absent, at `error`, so the state is read as the composition
 * defect it is rather than as an event-stack blip that will clear.
 *
 * The API process registers that pipeline now
 * (`api-identity-pipelines.composition.ts`, the fourth of four), so what is
 * left on this branch is a deployment that composed no queue at all and a
 * script that composed no eventing — both of which have already been told so
 * at boot. The branch stays because the swallow is what makes it invisible
 * otherwise: nothing else on the push path would report it.
 *
 * Like the identity ledger, the pipeline handle is resolved lazily off the
 * App: a bare script that never composes one must still be able to import
 * the runtime.
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
import type { ScimSyncLedger } from "../scim-sync-ledger";
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

export class ScimSyncLedgerWriter implements ScimSyncLedger {
  private readonly eventing: IdentityEventingPort;

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
   *
   * An absent sender is NOT a transient and is not logged as one: it means
   * this process composed the writer without registering `scim-sync` on its
   * own eventing, so every push's history is lost for as long as that holds.
   * The line names the pipeline and the command so the missing registration is
   * the first thing read, rather than "the stack is unavailable" — which it is
   * not.
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
