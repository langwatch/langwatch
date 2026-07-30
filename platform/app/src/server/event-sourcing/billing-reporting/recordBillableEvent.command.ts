import type { EmittedEvent, HandlerContext } from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { billingReportingEvents } from "./events";

const logger = createLogger(
  "langwatch:billing-reporting:record-billable-event",
);

/** What a source pipeline's own committed event carries that this bridge
 *  needs — narrower than that pipeline's own event union on purpose: nothing
 *  here reads a payload. */
export const billableSourceEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  /** Platform ingest time, epoch ms. */
  createdAt: z.number(),
  /** Business-level dedup key, when the source pipeline supplies one. */
  idempotencyKey: z.string().optional(),
});
export type BillableSourceEvent = z.infer<typeof billableSourceEventSchema>;

export interface RecordBillableEventPorts {
  resolveOrganizationId(projectId: string): Promise<string | undefined>;
}

/**
 * The command bridge (ADR-105 decision 7, consequences). `ctx.tenantId` is
 * the source event's own project id — the group key a source pipeline's
 * dispatch stamps this command with — so organization resolution is real,
 * deterministic work: the same project resolves to the same organization on
 * every retry.
 *
 * An orphan project (no organization) emits nothing rather than failing: a
 * command may emit zero events, and there is nothing here to meter.
 */
export function recordBillableEvent(ports: RecordBillableEventPorts) {
  return async (
    input: BillableSourceEvent,
    ctx: HandlerContext,
  ): Promise<readonly EmittedEvent<typeof billingReportingEvents>[]> => {
    const organizationId = await ports.resolveOrganizationId(ctx.tenantId);
    if (!organizationId) {
      logger.warn(
        { projectId: ctx.tenantId },
        "orphan project detected, has no organization -- skipping billable event",
      );
      return [];
    }

    return [
      {
        type: "billableEventRecorded",
        data: {
          eventId: input.id,
          eventType: input.type,
          organizationId,
          tenantId: ctx.tenantId,
          deduplicationKey: input.idempotencyKey ?? input.id,
          eventTimestamp: input.createdAt,
        },
      },
    ];
  };
}
