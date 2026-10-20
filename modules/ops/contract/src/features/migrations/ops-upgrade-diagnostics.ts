/**
 * One failed upgrade step's diagnostics, built and redacted on the install by ops; licensing
 * sends it over Connect. Plan: dev/docs/plans/upgrade-diagnostics-via-connect.md
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The largest bundle an install builds and the licence host accepts. */
export const UPGRADE_DIAGNOSTICS_MAX_BYTES = 64 * 1024;

const upgradeDiagnosticsTargetSchemaDefinition = z.object({
  target: z.string(),
  status: z.string(),
  version: z.string().nullable(),
  lastError: z.string().nullable(),
});
export interface UpgradeDiagnosticsTargetSchema extends Named<
  typeof upgradeDiagnosticsTargetSchemaDefinition
> {}
export const upgradeDiagnosticsTargetSchema: UpgradeDiagnosticsTargetSchema =
  upgradeDiagnosticsTargetSchemaDefinition;

const upgradeDiagnosticsBundleSchemaDefinition = z.object({
  /** Bumped when a field changes meaning; Cloud reads every version it ever accepted. */
  format: z.literal(1),
  generatedAt: z.string(),
  step: z.object({
    id: z.string(),
    kind: z.string(),
    mode: z.string(),
    description: z.string().nullable(),
    release: z.string().nullable(),
    status: z.string(),
    attempt: z.number().int(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    lastError: z.string().nullable(),
    report: z.record(z.string(), z.unknown()).nullable(),
    logTail: z.array(z.string()),
  }),
  targets: z.array(upgradeDiagnosticsTargetSchema),
  deployment: z.object({
    imageRelease: z.string().nullable(),
    chartVersion: z.string().nullable(),
    installMethod: z.string(),
    instanceId: z.string().nullable(),
  }),
  /** What the size cap or the redaction left out, so a reader knows the bundle is partial. */
  omitted: z.array(z.string()),
});
export interface UpgradeDiagnosticsBundleSchema extends Named<
  typeof upgradeDiagnosticsBundleSchemaDefinition
> {}
export const upgradeDiagnosticsBundleSchema: UpgradeDiagnosticsBundleSchema =
  upgradeDiagnosticsBundleSchemaDefinition;
export type UpgradeDiagnosticsBundle = z.infer<typeof upgradeDiagnosticsBundleSchema>;

/** Whether this install can send a bundle to LangWatch, and why not when it cannot. */
const opsUpgradeDiagnosticsAvailabilitySchemaDefinition = z.object({
  available: z.boolean(),
  reason: z.enum(["connect_disabled", "no_licence"]).nullable(),
  /** Whether the hourly check sends each newly failed step's bundle by itself. */
  automatic: z.boolean(),
});
export interface OpsUpgradeDiagnosticsAvailabilitySchema extends Named<
  typeof opsUpgradeDiagnosticsAvailabilitySchemaDefinition
> {}
export const opsUpgradeDiagnosticsAvailabilitySchema: OpsUpgradeDiagnosticsAvailabilitySchema =
  opsUpgradeDiagnosticsAvailabilitySchemaDefinition;
export type OpsUpgradeDiagnosticsAvailability = z.infer<
  typeof opsUpgradeDiagnosticsAvailabilitySchema
>;

/** What LangWatch filed a sent bundle under. */
const opsUpgradeDiagnosticsReceiptSchemaDefinition = z.object({
  reportId: z.string(),
  receivedAt: z.string(),
});
export interface OpsUpgradeDiagnosticsReceiptSchema extends Named<
  typeof opsUpgradeDiagnosticsReceiptSchemaDefinition
> {}
export const opsUpgradeDiagnosticsReceiptSchema: OpsUpgradeDiagnosticsReceiptSchema =
  opsUpgradeDiagnosticsReceiptSchemaDefinition;
export type OpsUpgradeDiagnosticsReceipt = z.infer<typeof opsUpgradeDiagnosticsReceiptSchema>;
