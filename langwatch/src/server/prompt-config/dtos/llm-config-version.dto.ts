import type { LatestConfigVersionSchema } from "../repositories/llm-config-version-schema";

/**
 * Interface for LLM Config Version data transfer objects
 */
export type LlmConfigVersionDTO = Omit<LatestConfigVersionSchema, "version">;
