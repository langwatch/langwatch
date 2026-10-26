import type { Named } from "@langwatch/module";
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
const upgradeDiagnosticsSubmissionSchemaDefinition = z.object({
  trigger: z.enum(["operator", "automatic"]),
  bundle: upgradeDiagnosticsBundleSchema,
});
export interface UpgradeDiagnosticsSubmissionSchema extends Named<
  typeof upgradeDiagnosticsSubmissionSchemaDefinition
> {}
export const upgradeDiagnosticsSubmissionSchema: UpgradeDiagnosticsSubmissionSchema =
  upgradeDiagnosticsSubmissionSchemaDefinition;
export type UpgradeDiagnosticsSubmission = z.infer<typeof upgradeDiagnosticsSubmissionSchema>;

/** The licence host's answer: the report id Cloud filed it under. */
const upgradeDiagnosticsReceiptSchemaDefinition = z.object({
  reportId: z.string(),
  receivedAt: z.string(),
});
export interface UpgradeDiagnosticsReceiptSchema extends Named<
  typeof upgradeDiagnosticsReceiptSchemaDefinition
> {}
export const upgradeDiagnosticsReceiptSchema: UpgradeDiagnosticsReceiptSchema =
  upgradeDiagnosticsReceiptSchemaDefinition;
export type UpgradeDiagnosticsReceipt = z.infer<typeof upgradeDiagnosticsReceiptSchema>;

/** One received report as Cloud admin lists it; the bundle itself is downloaded on demand. */
const upgradeDiagnosticsReportSchemaDefinition = z.object({
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
export interface UpgradeDiagnosticsReportSchema extends Named<
  typeof upgradeDiagnosticsReportSchemaDefinition
> {}
export const upgradeDiagnosticsReportSchema: UpgradeDiagnosticsReportSchema =
  upgradeDiagnosticsReportSchemaDefinition;
export type UpgradeDiagnosticsReport = z.infer<typeof upgradeDiagnosticsReportSchema>;

const upgradeDiagnosticsDownloadSchemaDefinition = z.object({
  url: z.string(),
  expiresAt: z.string(),
});
export interface UpgradeDiagnosticsDownloadSchema extends Named<
  typeof upgradeDiagnosticsDownloadSchemaDefinition
> {}
export const upgradeDiagnosticsDownloadSchema: UpgradeDiagnosticsDownloadSchema =
  upgradeDiagnosticsDownloadSchemaDefinition;
export type UpgradeDiagnosticsDownload = z.infer<typeof upgradeDiagnosticsDownloadSchema>;

/** Whether this install can send a bundle over Connect, and the reason it cannot. */
const upgradeDiagnosticsAvailabilitySchemaDefinition = z.object({
  available: z.boolean(),
  reason: z.enum(["connect_disabled", "no_licence"]).nullable(),
});
export interface UpgradeDiagnosticsAvailabilitySchema extends Named<
  typeof upgradeDiagnosticsAvailabilitySchemaDefinition
> {}
export const upgradeDiagnosticsAvailabilitySchema: UpgradeDiagnosticsAvailabilitySchema =
  upgradeDiagnosticsAvailabilitySchemaDefinition;
export type UpgradeDiagnosticsAvailability = z.infer<typeof upgradeDiagnosticsAvailabilitySchema>;

/** Whether this install can send a bundle, the instance it sends as, and the operator's opt-out. */
const upgradeDiagnosticsSettingsSchemaDefinition = z.object({
  ...upgradeDiagnosticsAvailabilitySchemaDefinition.shape,
  /** Null where the install never minted an identity row. */
  instanceId: z.string().nullable(),
  /** The operator switched off sending a failed step's diagnostics automatically. */
  optOut: z.boolean(),
});
export interface UpgradeDiagnosticsSettingsSchema extends Named<
  typeof upgradeDiagnosticsSettingsSchemaDefinition
> {}
export const upgradeDiagnosticsSettingsSchema: UpgradeDiagnosticsSettingsSchema =
  upgradeDiagnosticsSettingsSchemaDefinition;
export type UpgradeDiagnosticsSettings = z.infer<typeof upgradeDiagnosticsSettingsSchema>;

/** Cloud admin's list of one instance's reports, by the instance row it opened. */
const findUpgradeDiagnosticsInputSchemaDefinition = z.object({ instanceRowId: z.string().min(1) });
export interface FindUpgradeDiagnosticsInputSchema extends Named<
  typeof findUpgradeDiagnosticsInputSchemaDefinition
> {}
export const findUpgradeDiagnosticsInputSchema: FindUpgradeDiagnosticsInputSchema =
  findUpgradeDiagnosticsInputSchemaDefinition;

/** One report Cloud admin downloads. */
const upgradeDiagnosticsIdInputSchemaDefinition = z.object({ id: z.string().min(1) });
export interface UpgradeDiagnosticsIdInputSchema extends Named<
  typeof upgradeDiagnosticsIdInputSchemaDefinition
> {}
export const upgradeDiagnosticsIdInputSchema: UpgradeDiagnosticsIdInputSchema =
  upgradeDiagnosticsIdInputSchemaDefinition;
