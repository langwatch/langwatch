/**
 * Which saves import models from a provider's own `/v1/models` listing, shared by the save and
 * the drawer that keeps Save enabled for them.
 * Spec: specs/model-providers/custom-provider-model-import.feature
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

/** OpenAI's own API root. An OpenAI provider anywhere else is an OpenAI-compatible endpoint. */
export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

const modelImportOutcomeSchemaDefinition = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("imported"),
    added: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  z.object({ status: z.literal("failed") }),
  /** The organization used up its provider check budget; nothing was asked. */
  z.object({ status: z.literal("skipped") }),
]);
export interface ModelImportOutcomeSchema extends Named<
  typeof modelImportOutcomeSchemaDefinition
> {}
/** What a save did with the provider's model listing; absent when there is nothing to import. */
export const modelImportOutcomeSchema: ModelImportOutcomeSchema =
  modelImportOutcomeSchemaDefinition;
export type ModelImportOutcome = z.infer<typeof modelImportOutcomeSchema>;

/**
 * Whether saving this provider imports from its model listing: every custom provider, and an
 * OpenAI provider on a base URL other than OpenAI's own. OpenAI itself takes its models from the
 * catalogue.
 */
export function importsModelListing({
  provider,
  baseUrl,
}: {
  provider: string;
  baseUrl: string | undefined;
}): boolean {
  if (provider === "custom") return true;
  if (provider !== "openai" || !baseUrl?.trim()) return false;
  return !isSameEndpoint(baseUrl, OPENAI_DEFAULT_BASE_URL);
}

/** Whether two base URLs name the same API root, ignoring host case, trailing slashes and `/v1`. */
export function isSameEndpoint(a: string, b: string): boolean {
  return apiRoot(a) === apiRoot(b);
}

/** Scheme and host compare case-insensitively; the path keeps its case, servers may route on it. */
function apiRoot(url: string): string {
  const trimmed = url.trim();
  const parts = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)([^?#]*)/i.exec(trimmed);
  const normalized = parts
    ? `${(parts[1] ?? "").toLowerCase()}${(parts[2] ?? "").toLowerCase()}${parts[3] ?? ""}`
    : trimmed;
  const root = trimTrailingSlashes(normalized);
  return trimTrailingSlashes(root.endsWith("/v1") ? root.slice(0, -3) : root);
}

/** Drops trailing slashes in one linear pass; an anchored `/\/+$/` backtracks on long runs. */
function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end--;
  return value.slice(0, end);
}
