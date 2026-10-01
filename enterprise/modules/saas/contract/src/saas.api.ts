// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { moduleApi } from "@langwatch/kernel/module-api";
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

/** What an accepted usage report is answered with, on either door. */
export const usageReportReceiptSchema = z.object({ message: z.literal("Event captured") });

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
