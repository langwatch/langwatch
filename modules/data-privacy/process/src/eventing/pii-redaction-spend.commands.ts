import {
  PII_REDACTION_SPEND_AGGREGATE_TYPE,
  PII_REDACTION_SPEND_EVENT_VERSION,
  PII_REDACTION_SPEND_PRICED_EVENT_TYPE,
  piiRedactionSpendPricedEventDataSchema,
  type PiiRedactionSpendPricedEventData,
} from "@langwatch/data-privacy-contract/pii-redaction-spend";
import {
  type Command,
  type CommandHandler,
  createTenantId,
  defineCommandSchema,
  EventSchema,
  EventUtils,
} from "@langwatch/eventing";
import { z } from "zod";

const RECORD_PII_REDACTION_SPEND_PRICED_COMMAND_TYPE =
  "lw.data_privacy.record_pii_redaction_spend_priced" as const;

export const piiRedactionSpendPricedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PII_REDACTION_SPEND_PRICED_EVENT_TYPE),
  version: z.literal(PII_REDACTION_SPEND_EVENT_VERSION),
  data: piiRedactionSpendPricedEventDataSchema,
});
export type PiiRedactionSpendPricedEvent = z.infer<typeof piiRedactionSpendPricedEventSchema>;

/** Records one priced model call on the organization's aggregate, keyed by its request. */
export class RecordPiiRedactionSpendPricedCommand implements CommandHandler<
  Command<PiiRedactionSpendPricedEventData>,
  PiiRedactionSpendPricedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_PII_REDACTION_SPEND_PRICED_COMMAND_TYPE,
    piiRedactionSpendPricedEventDataSchema,
    "Record that a PII redaction model call was priced",
  );

  handle(command: Command<PiiRedactionSpendPricedEventData>): PiiRedactionSpendPricedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<PiiRedactionSpendPricedEvent>({
        aggregateType: PII_REDACTION_SPEND_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: PII_REDACTION_SPEND_PRICED_EVENT_TYPE,
        version: PII_REDACTION_SPEND_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:pii-redaction-spend-priced:${data.requestId}`,
      }),
    ];
  }

  static getAggregateId(payload: PiiRedactionSpendPricedEventData): string {
    return payload.organizationId;
  }
}
