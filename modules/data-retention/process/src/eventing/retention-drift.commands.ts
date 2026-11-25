import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";

import type { RetentionDriftCheckService } from "../services/retention-drift-check.service.ts";
import {
  type CheckRetentionDriftCommandData,
  CHECK_RETENTION_DRIFT_COMMAND_TYPE,
  checkRetentionDriftCommandDataSchema,
  RETENTION_DRIFT_AGGREGATE_TYPE,
  RETENTION_DRIFT_DETECTED_EVENT_TYPE,
  RETENTION_DRIFT_EVENT_VERSION,
  type RetentionDriftDetectedEvent,
} from "./retention-drift.events.ts";

/**
 * Checks one organization's sampled stored rows against its current periods and records the
 * projects that drifted, keyed by the wake, so a retried check records the day once.
 */
export class CheckRetentionDriftCommand implements CommandHandler<
  Command<CheckRetentionDriftCommandData>,
  RetentionDriftDetectedEvent
> {
  static readonly schema = defineCommandSchema(
    CHECK_RETENTION_DRIFT_COMMAND_TYPE,
    checkRetentionDriftCommandDataSchema,
    "Check an organization's stored rows against its current retention",
  );

  private constructor(private readonly checker: Pick<RetentionDriftCheckService, "check">) {}

  static create({
    checker,
  }: {
    checker: Pick<RetentionDriftCheckService, "check">;
  }): CheckRetentionDriftCommand {
    return new CheckRetentionDriftCommand(checker);
  }

  async handle(
    command: Command<CheckRetentionDriftCommandData>,
  ): Promise<RetentionDriftDetectedEvent[]> {
    const { organizationId, occurredAt } = command.data;
    const drifted = await this.checker.check({ organizationId, at: occurredAt });
    if (drifted.length === 0) return [];
    return [
      EventUtils.createEvent<RetentionDriftDetectedEvent>({
        aggregateType: RETENTION_DRIFT_AGGREGATE_TYPE,
        aggregateId: organizationId,
        tenantId: createTenantId(command.tenantId),
        type: RETENTION_DRIFT_DETECTED_EVENT_TYPE,
        version: RETENTION_DRIFT_EVENT_VERSION,
        data: { organizationId, drifted, checkedAt: occurredAt },
        metadata: {},
        occurredAt,
        idempotencyKey: `retention-drift:${organizationId}:${occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: CheckRetentionDriftCommandData): string {
    return payload.organizationId;
  }

  static getSpanAttributes(payload: CheckRetentionDriftCommandData): Record<string, string> {
    return { "payload.organization.id": payload.organizationId };
  }
}
