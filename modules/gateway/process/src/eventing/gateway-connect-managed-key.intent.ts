import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventSchema, EventUtils } from "@langwatch/eventing";
import {
  GATEWAY_CONNECT_MANAGED_KEY_AGGREGATE_TYPE,
  GATEWAY_CONNECT_MANAGED_KEY_EVENT_VERSION,
  GATEWAY_MANAGED_KEY_PROVISIONED_EVENT_TYPE,
  gatewayManagedKeyProvisionedEventDataSchema,
  type GatewayManagedKeyProvisionedEventData,
} from "@langwatch/gateway-contract";
import { z } from "zod";

export const GATEWAY_CONNECT_MANAGED_KEY_PIPELINE_NAME = "gateway_connect_managed_key" as const;
export const RECORD_MANAGED_KEY_PROVISIONED_COMMAND_TYPE =
  "lw.gateway.record_managed_key_provisioned" as const;
const MINUTE_MS = 60_000;

export const gatewayManagedKeyProvisionedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(GATEWAY_MANAGED_KEY_PROVISIONED_EVENT_TYPE),
  version: z.literal(GATEWAY_CONNECT_MANAGED_KEY_EVENT_VERSION),
  data: gatewayManagedKeyProvisionedEventDataSchema,
});
export type GatewayManagedKeyProvisionedEvent = z.infer<
  typeof gatewayManagedKeyProvisionedEventSchema
>;

/**
 * Records that gateway holds a licence's managed key. Bucketed per key per minute, like the
 * issued fact it answers, so a later ask is answered again when licensing missed the first.
 */
export class RecordManagedKeyProvisionedCommand implements CommandHandler<
  Command<GatewayManagedKeyProvisionedEventData>,
  GatewayManagedKeyProvisionedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_MANAGED_KEY_PROVISIONED_COMMAND_TYPE,
    gatewayManagedKeyProvisionedEventDataSchema,
    "Record that gateway provisioned a licence's managed key",
  );

  handle(
    command: Command<GatewayManagedKeyProvisionedEventData>,
  ): GatewayManagedKeyProvisionedEvent[] {
    const data = command.data;
    const minute = Math.floor(data.occurredAt / MINUTE_MS);
    return [
      EventUtils.createEvent<GatewayManagedKeyProvisionedEvent>({
        aggregateType: GATEWAY_CONNECT_MANAGED_KEY_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: GATEWAY_MANAGED_KEY_PROVISIONED_EVENT_TYPE,
        version: GATEWAY_CONNECT_MANAGED_KEY_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.issuedLicenseId}:${data.virtualKeyId}:managed_key_provisioned:${minute}`,
      }),
    ];
  }

  static getAggregateId(payload: GatewayManagedKeyProvisionedEventData): string {
    return payload.organizationId;
  }
}
