import { createTenantId, defineCommandSchema, EventUtils } from "../../..";
import type { Command, CommandHandler } from "../../../commands/command";
import {
  type RecordCanonicalLogCommandData,
  recordCanonicalLogCommandDataSchema,
} from "../schemas/commands";
import {
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
  RECORD_CANONICAL_LOG_COMMAND_TYPE,
} from "../schemas/constants";
import type { CanonicalLogRecordReceivedEvent } from "../schemas/events";

export class RecordCanonicalLogCommand
  implements
    CommandHandler<
      Command<RecordCanonicalLogCommandData>,
      CanonicalLogRecordReceivedEvent
    >
{
  static readonly schema = defineCommandSchema(
    RECORD_CANONICAL_LOG_COMMAND_TYPE,
    recordCanonicalLogCommandDataSchema,
    "Record one canonical OpenTelemetry log record",
  );

  async handle(
    command: Command<RecordCanonicalLogCommandData>,
  ): Promise<CanonicalLogRecordReceivedEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<CanonicalLogRecordReceivedEvent>({
        aggregateType: "log",
        aggregateId: data.recordId,
        tenantId: createTenantId(command.tenantId),
        type: CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
        version: CANONICAL_LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        // Tenant-scoped like every other command's. A RecordId is a content
        // hash that already includes its tenant, so a collision is not
        // reachable today — but nothing states that invariant at this layer,
        // and a dedup key that silently depends on it would suppress another
        // tenant's work the day it changes.
        idempotencyKey: `${command.tenantId}:${data.recordId}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordCanonicalLogCommandData): string {
    return payload.recordId;
  }

  static getSpanAttributes(
    payload: RecordCanonicalLogCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.log.record_id": payload.recordId,
      "payload.log.provider": payload.providerKind,
      "payload.log.severity": payload.severityNumber,
    };
  }
}
