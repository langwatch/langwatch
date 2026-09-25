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

export const governanceCostWindowInputSchema = z.object({
  organizationId: z.string(),
  windowDays: z.number().int().min(1).max(365).default(30),
});
export type GovernanceCostWindowInput = z.infer<typeof governanceCostWindowInputSchema>;

export const governanceCostPeriodRecordsInputSchema = z
  .object({
    organizationId: z.string(),
    fromDay: calendarDay,
    toDay: calendarDay,
    provider: z.string(),
  })
  .refine((input) => input.fromDay <= input.toDay, "A period cannot end before it starts.");
export type GovernanceCostPeriodRecordsInput = z.infer<
  typeof governanceCostPeriodRecordsInputSchema
>;

/** Main spreads the whole figure into every row, so the currency list rides on each. */
const figure = {
  amountUsd: z.number().nullable(),
  cellsWithoutAmount: z.number().int(),
  currenciesWithoutUsdAmount: z.array(z.string()),
};

export const governanceCostProviderDayRowSchema = z.object({
  day: z.string(),
  provider: z.string(),
  ...figure,
});
export type GovernanceCostProviderDayRow = z.infer<typeof governanceCostProviderDayRowSchema>;

export const governanceCostProviderDayBreakdownSchema = z.object({
  unavailableReason: governanceCostUnavailableReasonSchema.nullable(),
  rows: z.array(governanceCostProviderDayRowSchema),
  windowDays: z.number().int(),
});
export type GovernanceCostProviderDayBreakdown = z.infer<
  typeof governanceCostProviderDayBreakdownSchema
>;

export const governanceCostModelRowSchema = z.object({ model: z.string(), ...figure });
export type GovernanceCostModelRow = z.infer<typeof governanceCostModelRowSchema>;

export const governanceCostModelBreakdownSchema = z.object({
  unavailableReason: governanceCostUnavailableReasonSchema.nullable(),
  rows: z.array(governanceCostModelRowSchema),
  windowDays: z.number().int(),
});
export type GovernanceCostModelBreakdown = z.infer<typeof governanceCostModelBreakdownSchema>;

export const governanceCostDayRecordSchema = z.object({
  label: z.string(),
  ...figure,
});
export type GovernanceCostDayRecord = z.infer<typeof governanceCostDayRecordSchema>;

export const governanceCostDayRecordsSchema = z.object({
  unavailableReason: governanceCostUnavailableReasonSchema.nullable(),
  records: z.array(governanceCostDayRecordSchema),
});
export type GovernanceCostDayRecords = z.infer<typeof governanceCostDayRecordsSchema>;

export const governanceSpenderRowSchema = z.object({
  provider: z.string(),
  rawActorId: z.string(),
  label: z.string().nullable(),
  agentId: z.string(),
  ...figure,
});
export type GovernanceSpenderRow = z.infer<typeof governanceSpenderRowSchema>;

export const governanceSpenderBreakdownSchema = z.object({
  unavailableReason: governanceCostUnavailableReasonSchema.nullable(),
  rows: z.array(governanceSpenderRowSchema),
  windowDays: z.number().int(),
});
export type GovernanceSpenderBreakdown = z.infer<typeof governanceSpenderBreakdownSchema>;
