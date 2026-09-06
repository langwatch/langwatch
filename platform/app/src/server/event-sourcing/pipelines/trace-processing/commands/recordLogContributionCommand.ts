import { createTenantId, defineCommandSchema, EventUtils } from "../../..";
import type { Command, CommandHandler } from "../../../commands/command";
import {
  type RecordLogContributionCommandData,
  recordLogContributionCommandDataSchema,
} from "../schemas/commands";
import {
  LOG_CONTRIBUTED_EVENT_TYPE,
  LOG_CONTRIBUTED_EVENT_VERSION_LATEST,
  RECORD_LOG_CONTRIBUTION_COMMAND_TYPE,
} from "../schemas/constants";
import type { LogContributedEvent } from "../schemas/events";

export class RecordLogContributionCommand
  implements
    CommandHandler<
      Command<RecordLogContributionCommandData>,
      LogContributedEvent
    >
{
  static readonly schema = defineCommandSchema(
    RECORD_LOG_CONTRIBUTION_COMMAND_TYPE,
    recordLogContributionCommandDataSchema,
    "Attach a compact canonical log contribution to a trace",
  );

  async handle(
    command: Command<RecordLogContributionCommandData>,
  ): Promise<LogContributedEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<LogContributedEvent>({
        aggregateType: "trace",
        aggregateId: data.traceId,
        tenantId: createTenantId(command.tenantId),
        type: LOG_CONTRIBUTED_EVENT_TYPE,
        version: LOG_CONTRIBUTED_EVENT_VERSION_LATEST,
        data: {
          recordId: data.recordId,
          traceId: data.traceId,
          spanId: data.spanId,
          timeUnixMs: data.timeUnixMs,
          severityNumber: data.severityNumber,
          severityText: data.severityText,
          providerKind: data.providerKind,
          scopeName: data.scopeName,
          correlationSource: data.correlationSource,
          input: data.input,
          output: data.output,
          liftedAttributes: data.liftedAttributes,
          nonBillable: data.nonBillable,
          piiRedactionLevel: data.piiRedactionLevel,
        },
        metadata: {},
        occurredAt: data.occurredAt,
        // Tenant-scoped like every other trace command's. A RecordId is a
        // content hash that already includes its tenant, so a collision is
        // not reachable today — but nothing states that invariant at this
        // layer, and a dedup key that silently depends on it would suppress
        // another tenant's work the day it changes.
        idempotencyKey: `${command.tenantId}:${data.recordId}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordLogContributionCommandData): string {
    return payload.traceId;
  }
}
