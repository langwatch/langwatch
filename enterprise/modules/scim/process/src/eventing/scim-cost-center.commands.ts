// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  SCIM_COST_CENTER_CHANGED_EVENT_TYPE,
  SCIM_COST_CENTER_CHANGED_EVENT_VERSION,
  SCIM_MEMBER_AGGREGATE_TYPE,
} from "@langwatch/enterprise-scim-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";

import {
  RECORD_COST_CENTER_CHANGED_COMMAND_TYPE,
  type RecordCostCenterChangedCommandData,
  recordCostCenterChangedCommandDataSchema,
  type ScimCostCenterChangedEvent,
} from "./scim-cost-center.events.ts";

/**
 * Records the cost center a directory push named for one member. Each change is its own fact,
 * keyed by its instant, so a redelivered command records nothing new.
 */
export class RecordCostCenterChangedCommand implements CommandHandler<
  Command<RecordCostCenterChangedCommandData>,
  ScimCostCenterChangedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_COST_CENTER_CHANGED_COMMAND_TYPE,
    recordCostCenterChangedCommandDataSchema,
    "Record the cost center a SCIM directory push named for one member",
  );

  handle(command: Command<RecordCostCenterChangedCommandData>): ScimCostCenterChangedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<ScimCostCenterChangedEvent>({
        aggregateType: SCIM_MEMBER_AGGREGATE_TYPE,
        aggregateId: data.userId,
        tenantId: createTenantId(command.tenantId),
        type: SCIM_COST_CENTER_CHANGED_EVENT_TYPE,
        version: SCIM_COST_CENTER_CHANGED_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:${data.userId}:cost_center:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordCostCenterChangedCommandData): string {
    return payload.userId;
  }

  static getSpanAttributes(
    payload: RecordCostCenterChangedCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.organization.id": payload.organizationId,
      "payload.user.id": payload.userId,
    };
  }
}
