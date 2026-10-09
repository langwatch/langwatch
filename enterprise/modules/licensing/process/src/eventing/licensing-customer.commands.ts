import {
  LICENSING_CUSTOMER_AGGREGATE_TYPE,
  LICENSING_CUSTOMER_EVENT_VERSION,
  SELF_HOSTED_CUSTOMER_LICENSED_EVENT_TYPE,
  selfHostedCustomerLicensedEventDataSchema,
  type SelfHostedCustomerLicensedEventData,
} from "@langwatch/enterprise-licensing-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventSchema, EventUtils } from "@langwatch/eventing";
import { z } from "zod";

export const RECORD_SELF_HOSTED_CUSTOMER_LICENSED_COMMAND_TYPE =
  "lw.licensing.record_self_hosted_customer_licensed" as const;

export const selfHostedCustomerLicensedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(SELF_HOSTED_CUSTOMER_LICENSED_EVENT_TYPE),
  version: z.literal(LICENSING_CUSTOMER_EVENT_VERSION),
  data: selfHostedCustomerLicensedEventDataSchema,
});
export type SelfHostedCustomerLicensedEvent = z.infer<typeof selfHostedCustomerLicensedEventSchema>;

/** Records that an operator licensed a new self-hosted customer under a minted organisation id. */
export class RecordSelfHostedCustomerLicensedCommand implements CommandHandler<
  Command<SelfHostedCustomerLicensedEventData>,
  SelfHostedCustomerLicensedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_SELF_HOSTED_CUSTOMER_LICENSED_COMMAND_TYPE,
    selfHostedCustomerLicensedEventDataSchema,
    "Record that licensing licensed a new self-hosted customer",
  );

  handle(command: Command<SelfHostedCustomerLicensedEventData>): SelfHostedCustomerLicensedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<SelfHostedCustomerLicensedEvent>({
        aggregateType: LICENSING_CUSTOMER_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: SELF_HOSTED_CUSTOMER_LICENSED_EVENT_TYPE,
        version: LICENSING_CUSTOMER_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:self_hosted_customer_licensed`,
      }),
    ];
  }

  static getAggregateId(payload: SelfHostedCustomerLicensedEventData): string {
    return payload.organizationId;
  }
}
