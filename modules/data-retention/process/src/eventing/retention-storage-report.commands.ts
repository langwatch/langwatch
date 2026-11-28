import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";

import type { RetentionStorageReportService } from "../services/retention-storage-report.service.ts";
import {
  type ReportRetentionStorageCommandData,
  reportRetentionStorageCommandDataSchema,
  type RetentionStorageEvent,
  REPORT_RETENTION_STORAGE_COMMAND_TYPE,
  RETENTION_STORAGE_AGGREGATE_TYPE,
  RETENTION_STORAGE_EVENT_VERSION,
  RETENTION_STORAGE_MEASURED_EVENT_TYPE,
} from "./retention-storage-report.events.ts";

/**
 * Measures one organization's storage for one day and records it. The event is keyed by the
 * meter identifier, so a second run the same day collapses onto the first fact; an organization
 * billing has no storage line for records nothing.
 */
export class ReportRetentionStorageCommand implements CommandHandler<
  Command<ReportRetentionStorageCommandData>,
  RetentionStorageEvent
> {
  static readonly schema = defineCommandSchema(
    REPORT_RETENTION_STORAGE_COMMAND_TYPE,
    reportRetentionStorageCommandDataSchema,
    "Measure an organization's storage past the included retention for one day",
  );

  private constructor(private readonly measurer: Pick<RetentionStorageReportService, "measure">) {}

  static create({
    measurer,
  }: {
    measurer: Pick<RetentionStorageReportService, "measure">;
  }): ReportRetentionStorageCommand {
    return new ReportRetentionStorageCommand(measurer);
  }

  async handle(
    command: Command<ReportRetentionStorageCommandData>,
  ): Promise<RetentionStorageEvent[]> {
    const { organizationId, day, occurredAt } = command.data;
    const measured = await this.measurer.measure({ organizationId, day, measuredAt: occurredAt });
    return measured.map((data) =>
      EventUtils.createEvent<RetentionStorageEvent>({
        aggregateType: RETENTION_STORAGE_AGGREGATE_TYPE,
        aggregateId: organizationId,
        tenantId: createTenantId(command.tenantId),
        type: RETENTION_STORAGE_MEASURED_EVENT_TYPE,
        version: RETENTION_STORAGE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt,
        idempotencyKey: data.identifier,
      }),
    );
  }

  static getAggregateId(payload: ReportRetentionStorageCommandData): string {
    return payload.organizationId;
  }

  static getSpanAttributes(payload: ReportRetentionStorageCommandData): Record<string, string> {
    return {
      "payload.organization.id": payload.organizationId,
      "payload.retention_storage.day": payload.day,
    };
  }
}
