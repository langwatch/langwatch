// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { nurturingSignalSchema } from "@langwatch/enterprise-nurturing-contract";
import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

export const NURTURING_PIPELINE_NAME = "nurturing" as const;
export const NURTURING_SIGNAL_AGGREGATE_TYPE = "nurturing_signal" as const;
export const NURTURING_SIGNAL_RECORDED_EVENT_TYPE = "lw.nurturing.signal_recorded" as const;
export const NURTURING_SIGNAL_RECORDED_EVENT_VERSION = "2026-09-29" as const;
export const RECORD_NURTURING_SIGNAL_COMMAND_TYPE = "lw.nurturing.record_signal" as const;

/** One owner's signal, under the source event's tenant. */
export const recordNurturingSignalCommandDataSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  signal: nurturingSignalSchema,
});
export type RecordNurturingSignalCommandData = z.infer<
  typeof recordNurturingSignalCommandDataSchema
>;

export const nurturingSignalRecordedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(NURTURING_SIGNAL_RECORDED_EVENT_TYPE),
  version: z.literal(NURTURING_SIGNAL_RECORDED_EVENT_VERSION),
  data: recordNurturingSignalCommandDataSchema,
});
export type NurturingSignalRecordedEvent = z.infer<typeof nurturingSignalRecordedEventSchema>;
