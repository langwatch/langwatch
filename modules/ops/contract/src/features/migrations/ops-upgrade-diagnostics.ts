/**
 * One failed upgrade step's diagnostics, built and redacted on the install by ops; licensing
 * sends it over Connect. Plan: dev/docs/plans/upgrade-diagnostics-via-connect.md
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The largest bundle an install builds and the licence host accepts. */
export const UPGRADE_DIAGNOSTICS_MAX_BYTES = 64 * 1024;
/** The most log lines a bundle carries; matches the ledger's `STEP_LOG_TAIL_LINES`. */
export const UPGRADE_DIAGNOSTICS_LOG_TAIL_MAX_LINES = 200;
/** The longest error or log line a bundle carries; matches the ledger's `LEDGER_TEXT_MAX_CHARS`. */
export const UPGRADE_DIAGNOSTICS_TEXT_MAX_CHARS = 4096;

const diagnosticsText = z.string().max(UPGRADE_DIAGNOSTICS_TEXT_MAX_CHARS);

/** UTF-8 byte length without `TextEncoder` or `Buffer`, which this contract's libs do not carry. */
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const char of text) {
    bytes += utf8WidthOf(char.codePointAt(0) ?? 0);
  }
  return bytes;
}

function utf8WidthOf(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

const upgradeDiagnosticsTargetSchemaDefinition = z.object({
  target: z.string(),
  status: z.string(),
  version: z.string().nullable(),
  lastError: diagnosticsText.nullable(),
});
export interface UpgradeDiagnosticsTargetSchema extends Named<
  typeof upgradeDiagnosticsTargetSchemaDefinition
> {}
export const upgradeDiagnosticsTargetSchema: UpgradeDiagnosticsTargetSchema =
  upgradeDiagnosticsTargetSchemaDefinition;

const upgradeDiagnosticsBundleSchemaDefinition = z
  .object({
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
      lastError: diagnosticsText.nullable(),
      report: z.record(z.string(), z.unknown()).nullable(),
      logTail: z.array(diagnosticsText).max(UPGRADE_DIAGNOSTICS_LOG_TAIL_MAX_LINES),
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
  })
  .refine((bundle) => utf8ByteLength(JSON.stringify(bundle)) <= UPGRADE_DIAGNOSTICS_MAX_BYTES, {
    message: `a diagnostics bundle is at most ${UPGRADE_DIAGNOSTICS_MAX_BYTES} bytes`,
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
