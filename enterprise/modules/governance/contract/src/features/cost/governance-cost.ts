import type { Named } from "@langwatch/module";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The cost screen's read side (ADR-128 wave 1). @see specs/governance/governance-cost-screen.feature */
import { Temporal } from "@langwatch/time";
import { z } from "zod";

/** `no_cost_store`: no ClickHouse; `no_governance_project`: nothing ingested yet. */
export const governanceCostUnavailableReasonSchema = z.enum([
  "no_cost_store",
  "no_governance_project",
]);
export type GovernanceCostUnavailableReason = z.infer<typeof governanceCostUnavailableReasonSchema>;

/** `YYYY-MM-DD` naming a day the calendar has: the round trip refuses `2026-02-31`. */
export function isUtcCalendarDay(day: string): boolean {
  try {
    return Temporal.PlainDate.from(day, { overflow: "reject" }).toString() === day;
  } catch {
    return false;
  }
}

const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isUtcCalendarDay, "Not a day on the calendar.");

const governanceCostWindowInputSchemaDefinition = z.object({
  organizationId: z.string(),
  windowDays: z.number().int().min(1).max(365).default(30),
});
export interface GovernanceCostWindowInputSchema extends Named<
  typeof governanceCostWindowInputSchemaDefinition
> {}
export const governanceCostWindowInputSchema: GovernanceCostWindowInputSchema =
  governanceCostWindowInputSchemaDefinition;
export type GovernanceCostWindowInput = z.infer<typeof governanceCostWindowInputSchema>;

const governanceCostPeriodRecordsInputSchemaDefinition = z
  .object({
    organizationId: z.string(),
    fromDay: calendarDay,
    toDay: calendarDay,
    provider: z.string(),
  })
  .refine((input) => input.fromDay <= input.toDay, "A period cannot end before it starts.");
export interface GovernanceCostPeriodRecordsInputSchema extends Named<
  typeof governanceCostPeriodRecordsInputSchemaDefinition
> {}
export const governanceCostPeriodRecordsInputSchema: GovernanceCostPeriodRecordsInputSchema =
  governanceCostPeriodRecordsInputSchemaDefinition;
export type GovernanceCostPeriodRecordsInput = z.infer<
  typeof governanceCostPeriodRecordsInputSchema
>;

/** Main spreads the whole figure into every row, so the currency list rides on each. */
const figure = {
  amountUsd: z.number().nullable(),
  cellsWithoutAmount: z.number().int(),
  currenciesWithoutUsdAmount: z.array(z.string()),
};

const governanceCostProviderDayRowSchemaDefinition = z.object({
  day: z.string(),
  provider: z.string(),
  ...figure,
});
export interface GovernanceCostProviderDayRowSchema extends Named<
  typeof governanceCostProviderDayRowSchemaDefinition
> {}
export const governanceCostProviderDayRowSchema: GovernanceCostProviderDayRowSchema =
  governanceCostProviderDayRowSchemaDefinition;
export type GovernanceCostProviderDayRow = z.infer<typeof governanceCostProviderDayRowSchema>;

const governanceCostProviderDayBreakdownSchemaDefinition = z.object({
  unavailableReason: governanceCostUnavailableReasonSchema.nullable(),
  rows: z.array(governanceCostProviderDayRowSchema),
  windowDays: z.number().int(),
});
export interface GovernanceCostProviderDayBreakdownSchema extends Named<
  typeof governanceCostProviderDayBreakdownSchemaDefinition
> {}
export const governanceCostProviderDayBreakdownSchema: GovernanceCostProviderDayBreakdownSchema =
  governanceCostProviderDayBreakdownSchemaDefinition;
export type GovernanceCostProviderDayBreakdown = z.infer<
  typeof governanceCostProviderDayBreakdownSchema
>;

const governanceCostModelRowSchemaDefinition = z.object({ model: z.string(), ...figure });
export interface GovernanceCostModelRowSchema extends Named<
  typeof governanceCostModelRowSchemaDefinition
> {}
export const governanceCostModelRowSchema: GovernanceCostModelRowSchema =
  governanceCostModelRowSchemaDefinition;
export type GovernanceCostModelRow = z.infer<typeof governanceCostModelRowSchema>;

const governanceCostModelBreakdownSchemaDefinition = z.object({
  unavailableReason: governanceCostUnavailableReasonSchema.nullable(),
  rows: z.array(governanceCostModelRowSchema),
  windowDays: z.number().int(),
});
export interface GovernanceCostModelBreakdownSchema extends Named<
  typeof governanceCostModelBreakdownSchemaDefinition
> {}
export const governanceCostModelBreakdownSchema: GovernanceCostModelBreakdownSchema =
  governanceCostModelBreakdownSchemaDefinition;
export type GovernanceCostModelBreakdown = z.infer<typeof governanceCostModelBreakdownSchema>;

const governanceCostDayRecordSchemaDefinition = z.object({
  label: z.string(),
  ...figure,
});
export interface GovernanceCostDayRecordSchema extends Named<
  typeof governanceCostDayRecordSchemaDefinition
> {}
export const governanceCostDayRecordSchema: GovernanceCostDayRecordSchema =
  governanceCostDayRecordSchemaDefinition;
export type GovernanceCostDayRecord = z.infer<typeof governanceCostDayRecordSchema>;

const governanceCostDayRecordsSchemaDefinition = z.object({
  unavailableReason: governanceCostUnavailableReasonSchema.nullable(),
  records: z.array(governanceCostDayRecordSchema),
});
export interface GovernanceCostDayRecordsSchema extends Named<
  typeof governanceCostDayRecordsSchemaDefinition
> {}
export const governanceCostDayRecordsSchema: GovernanceCostDayRecordsSchema =
  governanceCostDayRecordsSchemaDefinition;
export type GovernanceCostDayRecords = z.infer<typeof governanceCostDayRecordsSchema>;

const governanceSpenderRowSchemaDefinition = z.object({
  provider: z.string(),
  rawActorId: z.string(),
  label: z.string().nullable(),
  agentId: z.string(),
  ...figure,
});
export interface GovernanceSpenderRowSchema extends Named<
  typeof governanceSpenderRowSchemaDefinition
> {}
export const governanceSpenderRowSchema: GovernanceSpenderRowSchema =
  governanceSpenderRowSchemaDefinition;
export type GovernanceSpenderRow = z.infer<typeof governanceSpenderRowSchema>;

const governanceSpenderBreakdownSchemaDefinition = z.object({
  unavailableReason: governanceCostUnavailableReasonSchema.nullable(),
  rows: z.array(governanceSpenderRowSchema),
  windowDays: z.number().int(),
});
export interface GovernanceSpenderBreakdownSchema extends Named<
  typeof governanceSpenderBreakdownSchemaDefinition
> {}
export const governanceSpenderBreakdownSchema: GovernanceSpenderBreakdownSchema =
  governanceSpenderBreakdownSchemaDefinition;
export type GovernanceSpenderBreakdown = z.infer<typeof governanceSpenderBreakdownSchema>;

const governanceCostCurrencyTotalSchemaDefinition = z.object({
  currencyCode: z.string(),
  amount: z.number().nullable(),
  cellsWithoutAmount: z.number().int(),
});
export interface GovernanceCostCurrencyTotalSchema extends Named<
  typeof governanceCostCurrencyTotalSchemaDefinition
> {}
export const governanceCostCurrencyTotalSchema: GovernanceCostCurrencyTotalSchema =
  governanceCostCurrencyTotalSchemaDefinition;
export type GovernanceCostCurrencyTotal = z.infer<typeof governanceCostCurrencyTotalSchema>;

/** One lane's figure; `requestsWithoutAmount` is the metered lane's alone and never withholds. */
const governanceCostLaneSchemaDefinition = z.object({
  ...figure,
  currencyTotals: z.array(governanceCostCurrencyTotalSchema),
  requestsWithoutAmount: z.number().int().optional(),
});
export interface GovernanceCostLaneSchema extends Named<
  typeof governanceCostLaneSchemaDefinition
> {}
export const governanceCostLaneSchema: GovernanceCostLaneSchema =
  governanceCostLaneSchemaDefinition;
export type GovernanceCostLane = z.infer<typeof governanceCostLaneSchema>;

/** Counts only: the seat lane carries no amount field at all (ADR-128). */
const governanceSeatPoolSchemaDefinition = z.object({
  skuPartNumber: z.string(),
  day: z.string(),
  seatsBought: z.number().int(),
  seatsAssigned: z.number().int(),
});
export interface GovernanceSeatPoolSchema extends Named<
  typeof governanceSeatPoolSchemaDefinition
> {}
export const governanceSeatPoolSchema: GovernanceSeatPoolSchema =
  governanceSeatPoolSchemaDefinition;
export type GovernanceSeatPool = z.infer<typeof governanceSeatPoolSchema>;

const governanceSeatLaneSchemaDefinition = z.discriminatedUnion("status", [
  z.object({ status: z.literal("awaiting_data") }),
  z.object({ status: z.literal("read_failed") }),
  z.object({ status: z.literal("reported"), pools: z.array(governanceSeatPoolSchema) }),
]);
export interface GovernanceSeatLaneSchema extends Named<
  typeof governanceSeatLaneSchemaDefinition
> {}
export const governanceSeatLaneSchema: GovernanceSeatLaneSchema =
  governanceSeatLaneSchemaDefinition;
export type GovernanceSeatLane = z.infer<typeof governanceSeatLaneSchema>;

const governanceCostDayCurrencyLineSchemaDefinition = z.object({
  currencyCode: z.string(),
  amount: z.number().nullable(),
  previousAmount: z.number().nullable(),
});
export interface GovernanceCostDayCurrencyLineSchema extends Named<
  typeof governanceCostDayCurrencyLineSchemaDefinition
> {}
export const governanceCostDayCurrencyLineSchema: GovernanceCostDayCurrencyLineSchema =
  governanceCostDayCurrencyLineSchemaDefinition;
export type GovernanceCostDayCurrencyLine = z.infer<typeof governanceCostDayCurrencyLineSchema>;

const governanceCostDaySchemaDefinition = z.object({
  day: z.string(),
  billedUsd: z.number().nullable(),
  gatewayUsd: z.number().nullable(),
  billedCellsWithoutAmount: z.number().int(),
  gatewayCellsWithoutAmount: z.number().int(),
  billedRevisedAt: z.number().nullable(),
  billedByCurrency: z.array(governanceCostDayCurrencyLineSchema),
  billedCurrenciesWithoutUsdAmount: z.array(z.string()),
  billedProvisional: z.boolean(),
});
export interface GovernanceCostDaySchema extends Named<typeof governanceCostDaySchemaDefinition> {}
export const governanceCostDaySchema: GovernanceCostDaySchema = governanceCostDaySchemaDefinition;
export type GovernanceCostDay = z.infer<typeof governanceCostDaySchema>;

const governanceCostStaleSourcesSchemaDefinition = z.object({
  oldestLastSuccessIso: z.string(),
  sourceNames: z.array(z.string()),
});
export interface GovernanceCostStaleSourcesSchema extends Named<
  typeof governanceCostStaleSourcesSchemaDefinition
> {}
export const governanceCostStaleSourcesSchema: GovernanceCostStaleSourcesSchema =
  governanceCostStaleSourcesSchemaDefinition;
export type GovernanceCostStaleSources = z.infer<typeof governanceCostStaleSourcesSchema>;

const governanceCostUnpricedWindowSchemaDefinition = z.object({
  sinceIso: z.string(),
  throughIso: z.string(),
  sourceNames: z.array(z.string()),
});
export interface GovernanceCostUnpricedWindowSchema extends Named<
  typeof governanceCostUnpricedWindowSchemaDefinition
> {}
export const governanceCostUnpricedWindowSchema: GovernanceCostUnpricedWindowSchema =
  governanceCostUnpricedWindowSchemaDefinition;
export type GovernanceCostUnpricedWindow = z.infer<typeof governanceCostUnpricedWindowSchema>;

/** Why a claimed Azure bill shows nothing; main's `azureBillingNote.ts` closed list. */
export const governanceAzureBillingNoteSchema = z.enum([
  "billing_read_failed",
  "prepaid_declared",
  "no_spend_recorded",
]);
export type GovernanceAzureBillingNote = z.infer<typeof governanceAzureBillingNoteSchema>;

/** The three lanes side by side, never summed into one figure. @see specs/governance/governance-cost-screen.feature */
const governanceCostSummarySchemaDefinition = z.object({
  unavailableReason: governanceCostUnavailableReasonSchema.nullable(),
  billed: governanceCostLaneSchema,
  providers: z.array(z.object({ provider: z.string(), ...figure })),
  gateway: governanceCostLaneSchema,
  azureBilling: governanceAzureBillingNoteSchema.nullable(),
  seats: governanceSeatLaneSchema,
  series: z.array(governanceCostDaySchema),
  windowDays: z.number().int(),
  staleSources: governanceCostStaleSourcesSchema.nullable(),
  unpricedWindow: governanceCostUnpricedWindowSchema.nullable(),
});
export interface GovernanceCostSummarySchema extends Named<
  typeof governanceCostSummarySchemaDefinition
> {}
export const governanceCostSummarySchema: GovernanceCostSummarySchema =
  governanceCostSummarySchemaDefinition;
export type GovernanceCostSummary = z.infer<typeof governanceCostSummarySchema>;
