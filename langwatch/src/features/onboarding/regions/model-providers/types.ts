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
  backendKey: string;
  key: ModelProviderKey;
  defaultModel?: string | null;
  label: string;
  icon: IconData;
  docs: Docs;
  fieldMetadata?: Record<string, FieldMetadata>;
}
