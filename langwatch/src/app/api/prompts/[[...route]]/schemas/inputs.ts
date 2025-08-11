import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";

/**
 * Schema for creating new prompt versions
 * Uses the latest config version schema from the repository
 */
export const versionInputSchema = getLatestConfigVersionSchema();
