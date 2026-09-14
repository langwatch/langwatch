/**
 * The directory-sync ledger writer.
 *
 * This one is NOT a `ConvergentLedgerWriter`, and the difference is policy
 * rather than plumbing — which is why it keeps a `commit` of its own while
 * still taking the sender machinery from the shared base:
 *
 *   - NO read-your-writes wait. Nothing on the SCIM request path reads this
 *     projection back: the endpoints answer from Postgres exactly as they did
 *     before, and holding an identity provider's HTTP request open while a
 *     fold converged would buy an unread row at the cost of the one property
 *     the protocol surface has to keep — answering as it always did.
 *
 *   - EVERY failure is swallowed, loudly. A push must never fail because its
 *     HISTORY could not be written. What the customer is owed is the
 *     membership consequence, which travels the grants ledger and is already
 *     durable by the time this runs. The opposite choice — refusing a push
 *     whose bookkeeping failed — would turn an event-stack blip into a
 *     directory outage.
 *
 * Both of those are stated once, here, instead of being implied by the
 * absence of code. What this no longer carries is its own copy of the sender
 * lookup and the staging step: those are the base's, same as everywhere else.
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
} from "@langwatch/identity";
import type { ScimSyncLedger } from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import { tryGetApp } from "~/server/app-layer/app";
import { createTenantId } from "~/server/event-sourcing";
import type { AggregateType } from "~/server/event-sourcing/domain/aggregateType";
import { scimSyncEventsFor } from "~/server/event-sourcing/pipelines/scim-sync/envelope";
import {
  SCIM_SYNC_AGGREGATE_TYPE,
  SCIM_SYNC_PIPELINE_NAME,
} from "~/server/event-sourcing/pipelines/scim-sync/schemas/constants";
import type { ScimSyncEvent } from "~/server/event-sourcing/pipelines/scim-sync/schemas/events";
import type { EventStore } from "~/server/event-sourcing/stores/eventStore.types";
import {
  appPipelineSender,
  StagedLedgerWriter,
  type StagedSenderPort,
} from "./staged-ledger-writer";

const logger = createLogger("langwatch:identity:scim-sync-ledger");

const SENDER_NAME_BY_COMMAND: Record<ScimSyncCommandType, string> = {
  [ISSUE_SCIM_TOKEN_COMMAND_TYPE]: "issueScimToken",
  [RECORD_SCIM_USER_PUSH_COMMAND_TYPE]: "recordScimUserPush",
  [RECORD_SCIM_GROUP_MAPPING_COMMAND_TYPE]: "recordScimGroupMapping",
  [RECORD_SCIM_APPLY_FAILURE_COMMAND_TYPE]: "recordScimApplyFailure",
  [REVOKE_SCIM_SYNC_COMMAND_TYPE]: "revokeScimSync",
};

/**
 * Read as it stands rather than waited for, unlike every other ledger's. A
 * ledger that swallows its failures has nothing to gain from waiting five
 * seconds for an App handle: it would spend a directory push's latency to
 * arrive at the same swallowed warning.
 */
function resolveEventStore(): EventStore<ScimSyncEvent> | null {
  const app = tryGetApp();
  return app?.eventSourcing?.isEnabled
    ? (app.eventSourcing.getEventStore<ScimSyncEvent>() ?? null)
    : null;
}

export interface ScimSyncLedgerWriterDeps {
  /** Production resolves the App's event store lazily; tests hand one in. */
  eventStore?: () => EventStore<ScimSyncEvent> | null;
  stagedSender?: StagedSenderPort;
}

export class ScimSyncLedgerWriter
  extends StagedLedgerWriter<ScimSyncCommand, ScimSyncEvent>
  implements ScimSyncLedger
{
  private readonly eventStore: () => EventStore<ScimSyncEvent> | null;

  constructor(deps: ScimSyncLedgerWriterDeps = {}) {
    super({
      stagedSender:
        deps.stagedSender ??
        appPipelineSender({ pipelineName: SCIM_SYNC_PIPELINE_NAME }),
      // Its own append, below, because an unavailable event store is a
      // warning here rather than the error the shared resolver raises.
      waitedAppend: null,
      // Named `null` rather than forgotten: see the header.
      readYourWrites: null,
    });
    this.eventStore = deps.eventStore ?? resolveEventStore;
  }

  protected senderNameFor(command: ScimSyncCommand): string {
    return SENDER_NAME_BY_COMMAND[command.type];
  }

  protected onMissingSender({
    command,
    senderName,
  }: {
    command: ScimSyncCommand;
    senderName: string;
  }): void {
    // Quiet, unlike its siblings: a fact that cannot be staged is history we
    // are missing, never a reason to refuse the identity provider's push.
    logger.warn(
      { commandType: command.type, senderName },
      "directory sync fact appended but not staged: the pipeline exposes no sender for it",
    );
  }

  async commit({
    command,
    facts,
  }: {
    command: ScimSyncCommand;
    facts: ScimSyncFactInput[];
  }): Promise<void> {
    const events = scimSyncEventsFor({ command, facts });
    if (events.length === 0) return;
    const { scimSyncId, connectionId, tenantId } = command.data;

    try {
      const eventStore = this.eventStore();
      if (!eventStore) {
        logger.warn(
          { scimSyncId, connectionId, commandType: command.type },
          "directory sync history not recorded: the event-sourcing stack is unavailable",
        );
        return;
      }
      await eventStore.storeEvents(
        events,
        { tenantId: createTenantId(tenantId) },
        SCIM_SYNC_AGGREGATE_TYPE as AggregateType,
      );
      await this.stage({ command });
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
}
