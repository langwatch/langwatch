/**
 * Sending a failed upgrade step's diagnostics over Connect and keeping them 30 days on Cloud.
 * The bundle is ops' (`upgradeDiagnosticsBundleSchema`).
 * Plan: dev/docs/plans/upgrade-diagnostics-via-connect.md
 */
import { upgradeDiagnosticsBundleSchema } from "@langwatch/ops-contract";
import { z } from "zod";

/** How long Cloud keeps a bundle before its storage rule removes it. */
export const UPGRADE_DIAGNOSTICS_RETENTION_DAYS = 30;

/** What an install sends: the bundle, and whether the operator or the hourly check sent it. */
export const upgradeDiagnosticsSubmissionSchema = z.object({
  trigger: z.enum(["operator", "automatic"]),
  bundle: upgradeDiagnosticsBundleSchema,
});
export type UpgradeDiagnosticsSubmission = z.infer<typeof upgradeDiagnosticsSubmissionSchema>;

/** The licence host's answer: the report id Cloud filed it under. */
export const upgradeDiagnosticsReceiptSchema = z.object({
  reportId: z.string(),
  receivedAt: z.string(),
});
export type UpgradeDiagnosticsReceipt = z.infer<typeof upgradeDiagnosticsReceiptSchema>;

/** One received report as Cloud admin lists it; the bundle itself is downloaded on demand. */
export const upgradeDiagnosticsReportSchema = z.object({
  id: z.string(),
  instanceId: z.string(),
  stepId: z.string(),
  stepDescription: z.string().nullable(),
  release: z.string().nullable(),
  attempt: z.number().int(),
  trigger: z.enum(["operator", "automatic"]),
  byteLength: z.number().int(),
  receivedAt: z.string(),
  expiresAt: z.string(),
});
export type UpgradeDiagnosticsReport = z.infer<typeof upgradeDiagnosticsReportSchema>;

export const upgradeDiagnosticsDownloadSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
});
export type UpgradeDiagnosticsDownload = z.infer<typeof upgradeDiagnosticsDownloadSchema>;

/** Whether this install can send a bundle over Connect, and the reason it cannot. */
export const upgradeDiagnosticsAvailabilitySchema = z.object({
  available: z.boolean(),
  reason: z.enum(["connect_disabled", "no_licence"]).nullable(),
});
export type UpgradeDiagnosticsAvailability = z.infer<typeof upgradeDiagnosticsAvailabilitySchema>;

/** Cloud admin's list of one instance's reports, by the instance row it opened. */
export const findUpgradeDiagnosticsInputSchema = z.object({ instanceRowId: z.string().min(1) });

/** One report Cloud admin downloads. */
export const upgradeDiagnosticsIdInputSchema = z.object({ id: z.string().min(1) });
