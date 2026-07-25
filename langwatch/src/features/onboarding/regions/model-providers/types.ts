import type { ServerModelProviderKey } from "~/hooks/useModelProviderFields";
import type { Docs, IconData } from "../shared/types";

export type ModelProviderKey =
  | "anthropic"
  | "aws_bedrock"
  | "cerebras"
  | "codex"
  | "custom"
  | "deepseek"
  | "gemini"
  | "grok_xai"
  | "groq"
  | "open_ai_azure"
  | "open_ai"
  | "vertex_ai";

/** The surfaces the provider grid renders on. */
export type ModelProviderSurface =
  | "evaluations"
  | "prompts"
  | "langy"
  | "onboarding";

export interface FieldMetadata {
  label: string;
  description?: string;
}

export interface ModelProviderSpec {
  /* The key that the backend uses to identify the model provider. This is different from the key used by the frontend. */
  backendModelProviderKey: ServerModelProviderKey;
  key: ModelProviderKey;
  defaultModel?: string | null;
  defaultBaseUrl?: string;
  label: string;
  icon: IconData;
  externalDocsUrl?: string;
  fieldMetadata?: Record<string, FieldMetadata>;
  /**
   * How the provider is credentialed. "oauth-device" replaces the key
   * fields with a sign-in-with-the-provider flow (Codex). Absent =
   * API-key fields from the schema.
   */
  authFlow?: "oauth-device";
  /**
   * Surfaces where this provider LEADS the grid with a "Recommended"
   * badge. Registry array order stays the default everywhere else.
   */
  recommendedOn?: readonly ModelProviderSurface[];
  /**
   * Surfaces that must not offer this provider at all — e.g. Codex cannot
   * serve evaluations or prompt runs, so offering it there would strand
   * the flow it was picked for.
   */
  hiddenOn?: readonly ModelProviderSurface[];
}
