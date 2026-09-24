import { API_KEY_REVOCATION_CAUSES } from "@langwatch/api-key-contract";
import { z } from "zod";

export const ingestionKeyMintCommandSchema = z
  .object({
    callerUserId: z.string().min(1),
    ownerUserId: z.string().nullable(),
    organizationId: z.string().min(1),
    projectId: z.string().min(1),
    sourceType: z.string().min(1),
    ingestionTemplateId: z.string().nullable().optional(),
    createdByDeviceLabel: z.string().nullable().optional(),
  })
  .strict();
export type IngestionKeyMintCommand = z.infer<typeof ingestionKeyMintCommandSchema>;

export const issuedIngestionKeySchema = z
  .object({
    token: z.string().min(1),
    apiKeyId: z.string().min(1),
    prefix: z.string().min(1),
    sourceType: z.string().min(1),
  })
  .strict();
export type IssuedIngestionKey = z.infer<typeof issuedIngestionKeySchema>;

/**
 * The source types the CLI wraps, each stamped as `langwatch.source`. A
 * personal key for one comes only from the CLI session on the machine that
 * runs the tool; the /me tile and MCP mint template-named sources instead.
 */
export const PERSONAL_INGEST_SOURCE_TYPES = [
  "claude_code",
  "codex",
  "gemini",
  "opencode",
  "copilot_cli",
  "copilot_vscode",
  "copilot_app",
] as const;

/** What became of one of the caller's own personal ingest keys. */
export const personalIngestionKeyStateSchema = z
  .object({
    sourceType: z.string().min(1),
    live: z.boolean(),
    revocationCause: z.enum(API_KEY_REVOCATION_CAUSES).nullable(),
  })
  .strict();
export type PersonalIngestionKeyState = z.infer<typeof personalIngestionKeyStateSchema>;
