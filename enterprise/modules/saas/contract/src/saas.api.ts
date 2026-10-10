// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { moduleApi, type Named } from "@langwatch/module";
import { USAGE_REPORT_MAX_BODY_BYTES, usageReportBodySchema } from "@langwatch/ops-contract";
import { z } from "zod";

/** The report as either door reads it: ops' body, with unknown fields kept so they can be counted. */
const usageReportRequestSchemaDefinition = usageReportBodySchema.loose();
export interface UsageReportRequestSchema extends Named<
  typeof usageReportRequestSchemaDefinition
> {}
export const usageReportRequestSchema: UsageReportRequestSchema =
  usageReportRequestSchemaDefinition;

/** The largest report either door reads. */
export const USAGE_REPORT_REQUEST_MAX_BYTES = USAGE_REPORT_MAX_BODY_BYTES;

/** The proxy headers that name a sender's address. */
const senderAddressHeadersSchemaDefinition = z.object({
  "cf-connecting-ip": z.string().optional(),
  "x-forwarded-for": z.string().optional(),
  "x-real-ip": z.string().optional(),
  "true-client-ip": z.string().optional(),
});
export interface SenderAddressHeadersSchema extends Named<
  typeof senderAddressHeadersSchemaDefinition
> {}
export const senderAddressHeadersSchema: SenderAddressHeadersSchema =
  senderAddressHeadersSchemaDefinition;

/** A release as Cloud names it: the release name and the commit it was built from. */
const releaseIdentitySchemaDefinition = z.object({
  release: z.string(),
  commit: z.string().nullable(),
});
export interface ReleaseIdentitySchema extends Named<typeof releaseIdentitySchemaDefinition> {}
export const releaseIdentitySchema: ReleaseIdentitySchema = releaseIdentitySchemaDefinition;

/** What an accepted usage report is answered with, on either door; release fields only when configured. */
const usageReportReceiptSchemaDefinition = z.object({
  message: z.literal("Event captured"),
  latest_release: releaseIdentitySchema.optional(),
  floor: z.string().optional(),
});
export interface UsageReportReceiptSchema extends Named<
  typeof usageReportReceiptSchemaDefinition
> {}
export const usageReportReceiptSchema: UsageReportReceiptSchema =
  usageReportReceiptSchemaDefinition;

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

const saasBrowserUserSchemaDefinition = z.object({
  id: z.string(),
  email: z.string().nullish(),
  name: z.string().nullish(),
  impersonator: z.object({ id: z.string() }).nullish(),
});
export interface SaasBrowserUserSchema extends Named<typeof saasBrowserUserSchemaDefinition> {}
export const saasBrowserUserSchema: SaasBrowserUserSchema = saasBrowserUserSchemaDefinition;

const saasBrowserScopeSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
});
export interface SaasBrowserScopeSchema extends Named<typeof saasBrowserScopeSchemaDefinition> {}
export const saasBrowserScopeSchema: SaasBrowserScopeSchema = saasBrowserScopeSchemaDefinition;

export type SaasBrowserUser = z.infer<typeof saasBrowserUserSchema>;
export type SaasBrowserScope = z.infer<typeof saasBrowserScopeSchema>;

/** What a browser is told: which product it is looking at. */
const saasWebConfigSchemaDefinition = z.strictObject({
  deployment: z.enum(["saas", "self-hosted"]),
});
export interface SaasWebConfigSchema extends Named<typeof saasWebConfigSchemaDefinition> {}
export const saasWebConfigSchema: SaasWebConfigSchema = saasWebConfigSchemaDefinition;

export type SaasWebConfig = z.infer<typeof saasWebConfigSchema>;

/** saas's facts about self-hosted usage reports; nurturing sends them on to PostHog (rule 7). */
export const SAAS_USAGE_REPORT_PIPELINE_NAME = "saas_usage_report" as const;
export const SAAS_USAGE_REPORT_AGGREGATE_TYPE = "saas_usage_report" as const;
export const USAGE_REPORT_RECEIVED_EVENT_TYPE = "lw.saas.usage_report_received" as const;
export const USAGE_REPORT_RECEIVED_EVENT_VERSION = "2026-10-10" as const;

/** One accepted report, as product analytics receives it: the event against the install id. */
const usageReportReceivedEventDataSchemaDefinition = z.object({
  instanceId: z.string().min(1),
  event: z.string().min(1),
  properties: z.record(z.string(), z.unknown()),
  unknownFields: z.number().int().nonnegative(),
});
export interface UsageReportReceivedEventDataSchema extends Named<
  typeof usageReportReceivedEventDataSchemaDefinition
> {}
export const usageReportReceivedEventDataSchema: UsageReportReceivedEventDataSchema =
  usageReportReceivedEventDataSchemaDefinition;
export type UsageReportReceivedEventData = z.infer<typeof usageReportReceivedEventDataSchema>;
