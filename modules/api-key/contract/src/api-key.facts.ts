import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The most keys one facts read answers: live keys first, then the newest revoked ones. */
export const API_KEY_FACTS_LIMIT = 1000;

/** What a key is, read from its stored marks; never from a name a customer chose. */
export const API_KEY_KINDS = [
  "personal",
  "service",
  "ingestion",
  "cli_login",
  "docs_session",
  "staff_read",
  "staff_support",
  "langy_session",
  "agent_sandbox",
  "workflow_run",
  "gateway_trace_export",
  "checkup_canary",
  "system",
] as const;
export const apiKeyKindSchema = z.enum(API_KEY_KINDS);
export type ApiKeyKind = z.infer<typeof apiKeyKindSchema>;

const apiKeyFactsInputSchemaDefinition = z.object({ organizationId: z.string().min(1) }).strict();
export interface ApiKeyFactsInputSchema extends Named<typeof apiKeyFactsInputSchemaDefinition> {}
export const apiKeyFactsInputSchema: ApiKeyFactsInputSchema = apiKeyFactsInputSchemaDefinition;
export type ApiKeyFactsInput = z.infer<typeof apiKeyFactsInputSchema>;

/**
 * One key as a staff investigation reads it: id, kind, reach and times. Never the name, the
 * token, its prefix, the lookup id or the hash. Times are epoch milliseconds.
 */
const apiKeyFactsSchemaDefinition = z
  .object({
    id: z.string(),
    kind: apiKeyKindSchema,
    /** The one project every grant of the key is on; null for a wider or mixed key. */
    projectId: z.string().nullable(),
    createdAt: z.number().int(),
    lastUsedAt: z.number().int().nullable(),
    expiresAt: z.number().int().nullable(),
    revokedAt: z.number().int().nullable(),
    /** Custom-role permissions, and `role:<name>` for each built-in role the key is granted. */
    permissions: z.array(z.string()),
  })
  .strict();
export interface ApiKeyFactsSchema extends Named<typeof apiKeyFactsSchemaDefinition> {}
export const apiKeyFactsSchema: ApiKeyFactsSchema = apiKeyFactsSchemaDefinition;
export type ApiKeyFacts = z.infer<typeof apiKeyFactsSchema>;
