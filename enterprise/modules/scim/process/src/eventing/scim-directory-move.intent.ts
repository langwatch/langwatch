// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventSchema, EventUtils } from "@langwatch/eventing";
import { z } from "zod";

export const SCIM_DIRECTORY_PIPELINE_NAME = "scim_directory" as const;
export const SCIM_DIRECTORY_AGGREGATE_TYPE = "scim_directory_move" as const;
export const SCIM_DIRECTORY_MOVE_REQUESTED_EVENT_TYPE = "lw.scim.directory_move_requested" as const;
export const SCIM_DIRECTORY_MOVE_REQUESTED_EVENT_VERSION = "2026-09-25" as const;
export const REQUEST_DIRECTORY_MOVE_COMMAND_TYPE = "lw.scim.request_directory_move" as const;

export const requestDirectoryMoveCommandDataSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  fromConnectionId: z.string().min(1),
  toConnectionId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
});
export type RequestDirectoryMoveCommandData = z.infer<typeof requestDirectoryMoveCommandDataSchema>;

export const scimDirectoryMoveRequestedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(SCIM_DIRECTORY_MOVE_REQUESTED_EVENT_TYPE),
  version: z.literal(SCIM_DIRECTORY_MOVE_REQUESTED_EVENT_VERSION),
  data: requestDirectoryMoveCommandDataSchema,
});
export type ScimDirectoryMoveRequestedEvent = z.infer<typeof scimDirectoryMoveRequestedEventSchema>;

/**
 * One directory sync re-homed onto the connection that replaced its own. The aggregate is the
 * replacement, and the pair is the idempotency key, so a redelivered request records nothing new.
 */
export class RequestDirectoryMoveCommand implements CommandHandler<
  Command<RequestDirectoryMoveCommandData>,
  ScimDirectoryMoveRequestedEvent
> {
  static readonly schema = defineCommandSchema(
    REQUEST_DIRECTORY_MOVE_COMMAND_TYPE,
    requestDirectoryMoveCommandDataSchema,
    "Move one connection's directory sync onto the connection that replaced it",
  );

  async handle(
    command: Command<RequestDirectoryMoveCommandData>,
  ): Promise<ScimDirectoryMoveRequestedEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<ScimDirectoryMoveRequestedEvent>({
        aggregateType: SCIM_DIRECTORY_AGGREGATE_TYPE,
        aggregateId: data.toConnectionId,
        tenantId: createTenantId(command.tenantId),
        type: SCIM_DIRECTORY_MOVE_REQUESTED_EVENT_TYPE,
        version: SCIM_DIRECTORY_MOVE_REQUESTED_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.fromConnectionId}:${data.toConnectionId}`,
      }),
    ];
  }

  static getAggregateId(payload: RequestDirectoryMoveCommandData): string {
    return payload.toConnectionId;
  }

  static getSpanAttributes(
    payload: RequestDirectoryMoveCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.scim_directory.from_connection_id": payload.fromConnectionId,
      "payload.scim_directory.to_connection_id": payload.toConnectionId,
    };
  }
}
