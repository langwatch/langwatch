import type { ServerModelProviderKey } from "~/hooks/useModelProviderFields";
import type { Docs, IconData } from "../shared/types";

export type ModelProviderKey =
  | "anthropic"
  | "aws_bedrock"
  | "cerebras"
  | "custom"
  | "deepseek"
  | "gemini"
  | "grok_xai"
  | "groq"
  | "open_ai_azure"
  | "open_ai"
  | "vertex_ai";

export interface FieldMetadata {
  label: string;
  description?: string;
}

export interface ModelProviderSpec {
  /* The key that the backend uses to identify the model provider. This is different from the key used by the frontend. */
  backendModelProviderKey: ServerModelProviderKey;
  key: ModelProviderKey;
  defaultModel?: string | null;
  label: string;
  icon: IconData;
  externalDocsUrl?: string;
  fieldMetadata?: Record<string, FieldMetadata>;
}
