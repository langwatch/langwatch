// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { moduleApi } from "@langwatch/module";
import { USAGE_REPORT_MAX_BODY_BYTES, usageReportBodySchema } from "@langwatch/ops-contract";
import { z } from "zod";

/** The report as either door reads it: ops' body, with unknown fields kept so they can be counted. */
export const usageReportRequestSchema = usageReportBodySchema.loose();

/** The largest report either door reads. */
export const USAGE_REPORT_REQUEST_MAX_BYTES = USAGE_REPORT_MAX_BODY_BYTES;

/** The proxy headers that name a sender's address. */
export const senderAddressHeadersSchema = z.object({
  "cf-connecting-ip": z.string().optional(),
  "x-forwarded-for": z.string().optional(),
  "x-real-ip": z.string().optional(),
  "true-client-ip": z.string().optional(),
});

/** A release as Cloud names it: the release name and the commit it was built from. */
export const releaseIdentitySchema = z.object({
  release: z.string(),
  commit: z.string().nullable(),
});

/** What an accepted usage report is answered with, on either door; release fields only when configured. */
export const usageReportReceiptSchema = z.object({
  message: z.literal("Event captured"),
  latest_release: releaseIdentitySchema.optional(),
  floor: z.string().optional(),
});

export type UsageReportReceipt = z.infer<typeof usageReportReceiptSchema>;

/** One posted report as the door read it: the body, and the headers naming the sender's address. */
export interface IncomingUsageReportRequest {
  readonly report: Readonly<Record<string, unknown>>;
  readonly addressHeaders: Readonly<Record<string, string | undefined>>;
}

/** LangWatch Cloud's own surface. Every operation refuses on any other deployment. */
export interface SaasApi {
  receiveUsageReport(input: IncomingUsageReportRequest): Promise<UsageReportReceipt>;
}

export const SaasApi = moduleApi<SaasApi>()("saas");

export const SAAS_FEATURE_ID = "saas" as const;

export const saasBrowserUserSchema = z.object({
  id: z.string(),
  email: z.string().nullish(),
  name: z.string().nullish(),
  impersonator: z.object({ id: z.string() }).nullish(),
});

export const saasBrowserScopeSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type SaasBrowserUser = z.infer<typeof saasBrowserUserSchema>;
export type SaasBrowserScope = z.infer<typeof saasBrowserScopeSchema>;

/** What a browser is told: which product it is looking at. */
export const saasWebConfigSchema = z.strictObject({
  deployment: z.enum(["saas", "self-hosted"]),
});

export type SaasWebConfig = z.infer<typeof saasWebConfigSchema>;

/** saas's facts about self-hosted usage reports; nurturing sends them on to PostHog (rule 7). */
export const SAAS_USAGE_REPORT_PIPELINE_NAME = "saas_usage_report" as const;
export const SAAS_USAGE_REPORT_AGGREGATE_TYPE = "saas_usage_report" as const;
export const USAGE_REPORT_RECEIVED_EVENT_TYPE = "lw.saas.usage_report_received" as const;
export const USAGE_REPORT_RECEIVED_EVENT_VERSION = "2026-10-10" as const;

/** One accepted report, as product analytics receives it: the event against the install id. */
export const usageReportReceivedEventDataSchema = z.object({
  instanceId: z.string().min(1),
  event: z.string().min(1),
  properties: z.record(z.string(), z.unknown()),
  unknownFields: z.number().int().nonnegative(),
});
export type UsageReportReceivedEventData = z.infer<typeof usageReportReceivedEventDataSchema>;
