/**
 * The directory-sync ledger writer: the app's implementation of
 * `@langwatch/identity-server`'s ScimSyncLedger, in the shape the identity,
 * grants and connection ledgers already have (ADR-110, ADR-101):
 *
 *   1. the durable ClickHouse append, WAITED — the fact lands before the
 *      caller returns;
 *   2. the command staged onto the per-sync GroupQueue, awaited — the fold is
 *      the queue's, and nothing here applies a projection itself.
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
import type { ScimSyncLedger } from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import { tryGetApp } from "~/server/app-layer/app";
import { type AggregateType, createTenantId, type EventStore } from "@langwatch/eventing";
import {
  SCIM_SYNC_AGGREGATE_TYPE,
  SCIM_SYNC_PIPELINE_NAME,
  type ScimSyncEvent,
  scimSyncEventsFor,
} from "@langwatch/identity-eventing";

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

function resolveEventStore(): EventStore<ScimSyncEvent> | null {
  const app = tryGetApp();
  return app?.eventSourcing?.isEnabled
    ? (app.eventSourcing.getEventStore<ScimSyncEvent>() ?? null)
    : null;
}

function resolveStagedSender(name: string): ScimSyncStagedSender | null {
  const app = tryGetApp();
  if (!app?.eventSourcing?.isEnabled) return null;
  try {
    const pipeline = app.eventSourcing.getPipeline(
      SCIM_SYNC_PIPELINE_NAME as never,
    ) as unknown as { commands: Record<string, ScimSyncStagedSender> };
    return pipeline.commands[name] ?? null;
  } catch {
    return null;
  }
}

export interface ScimSyncLedgerWriterDeps {
  /** Production resolves the App's event store lazily; tests hand one in. */
  eventStore?: () => EventStore<ScimSyncEvent> | null;
  stagedSender?: (name: string) => ScimSyncStagedSender | null;
}

export class ScimSyncLedgerWriter implements ScimSyncLedger {
  private readonly eventStore: () => EventStore<ScimSyncEvent> | null;
  private readonly stagedSender: (name: string) => ScimSyncStagedSender | null;

  constructor(deps: ScimSyncLedgerWriterDeps = {}) {
    this.eventStore = deps.eventStore ?? resolveEventStore;
    this.stagedSender = deps.stagedSender ?? resolveStagedSender;
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

  private async stage({
    command,
  }: {
    command: ScimSyncCommand;
  }): Promise<void> {
    const senderName = SENDER_NAME_BY_COMMAND[command.type];
    const sender = this.stagedSender(senderName);
    if (!sender) {
      logger.warn(
        { commandType: command.type, senderName },
        "directory sync fact appended but not staged: the pipeline exposes no sender for it",
      );
      return;
    }
    await sender.send(command.data);
  }
}
