import {
  getBillingMonth,
  getPreviousBillingMonth,
} from "@ee/billing/services/billableEventsQuery";
import type {
  EvolveStep,
  IntentDef,
  ProcessContext,
  ProcessManagerHandlerMap,
} from "@langwatch/event-sourcing";
import { z } from "zod";
import { billingReportingEvents } from "./events";
import { type ReportUsagePayload, type ReportUsagePorts, reportUsage, reportUsagePayloadSchema } from "./reportUsage";

export const BILLING_METER_POKE_PROCESS_NAME = "billingMeterPoke" as const;

/** One kill switch for every mount of the poke, spelled as the poke's own
 *  home rather than any source pipeline's — an operator stopping billing
 *  pokes during an incident must not have to find and flip four flags. Not
 *  consumed here: staging a job is dispatch-plane / executor territory this
 *  package does not yet have (see this pipeline's report). */
export const BILLING_METER_POKE_KILL_SWITCH_KEY =
  "es-billing_report-subscriber-billingMeterPoke-killswitch" as const;

/** Days into a new month during which the previous month is still reported,
 *  so late events land on the invoice they belong to. Shared with the
 *  sweep — if they disagreed, the sweep would re-read a month the poke had
 *  already abandoned. */
export const BILLING_GRACE_PERIOD_DAYS = 3;

/** No durable state of its own: every field the poke needs is already on the
 *  event, so there is nothing to accumulate between deliveries. */
export const billingMeterPokeStateSchema = z.object({}).strict();
export type BillingMeterPokeState = z.infer<typeof billingMeterPokeStateSchema>;

export function initBillingMeterPokeState(): BillingMeterPokeState {
  return {};
}

export function billingMeterPokeIntents(ports: ReportUsagePorts) {
  return {
    reportUsage: {
      payload: reportUsagePayloadSchema,
      messageKey: (payload: ReportUsagePayload) => `${payload.organizationId}:${payload.billingMonth}`,
      deliver: (payload: ReportUsagePayload) => reportUsage(ports, payload),
    } satisfies IntentDef<typeof reportUsagePayloadSchema>,
  };
}

type BillingMeterPokeIntents = ReturnType<typeof billingMeterPokeIntents>;

/**
 * The billing poke (ADR-098): a billable event was recorded for this
 * organization, so re-read its month total and report it. A trigger, not the
 * guarantee — that is `billingMeterSweep.process.ts`, mounted separately
 * because it is scoped globally rather than per organization.
 *
 * Both months' intents dedup on `${organizationId}:${billingMonth}`, so a
 * project ingesting continuously mints one durable intent per organization
 * per month rather than one per event; the report itself reads the month
 * total as a LEVEL, so a redelivery — or a poke that never lands — costs
 * nothing the next poke or the sweep does not recover.
 */
export const billingMeterPokeOn: ProcessManagerHandlerMap<
  typeof billingReportingEvents,
  BillingMeterPokeState,
  BillingMeterPokeIntents
> = {
  billableEventRecorded(state, data, ctx: ProcessContext): EvolveStep<BillingMeterPokeState, BillingMeterPokeIntents> {
    const at = new Date(ctx.now);
    const billingMonths: string[] = [];
    if (at.getUTCDate() <= BILLING_GRACE_PERIOD_DAYS) {
      billingMonths.push(getPreviousBillingMonth(at));
    }
    billingMonths.push(getBillingMonth(at));

    return {
      state,
      intents: billingMonths.map((billingMonth) => ({
        type: "reportUsage" as const,
        payload: { organizationId: data.organizationId, billingMonth, tenantId: data.tenantId, occurredAt: ctx.now },
      })),
      nextWakeAt: null,
    };
  },
};
