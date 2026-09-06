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

export const personalIngestionKeySchema = z
  .object({
    apiKeyId: z.string(),
    sourceType: z.string(),
    lookupId: z.string(),
    ingestionTemplateId: z.string().nullable(),
  })
  .strict();
export type PersonalIngestionKey = z.infer<typeof personalIngestionKeySchema>;

/**
 * The source types a personal key may be minted for: the tools the CLI wraps
 * or captures, each stamped as `langwatch.source`. The personal mint is capped
 * per source type, so an open set would make the cap meaningless — a device
 * session could hold the cap again under every value it invents. A new tool
 * joins here when the CLI learns to wrap it.
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

/**
 * Live personal ingest keys one workspace may hold per (sourceType, template).
 * Sized for a person's real machines with room to spare: a few laptops, a few
 * cloud machines, and the forks of a golden image that share their parent's
 * key rather than minting their own.
 */
export const PERSONAL_INGEST_KEYS_PER_TOOL_CAP = 32;

/** What became of one of the caller's own personal ingest keys. */
export const personalIngestionKeyStateSchema = z
  .object({
    sourceType: z.string().min(1),
    live: z.boolean(),
    revocationCause: z.enum(API_KEY_REVOCATION_CAUSES).nullable(),
  })
  .strict();
export type PersonalIngestionKeyState = z.infer<typeof personalIngestionKeyStateSchema>;
