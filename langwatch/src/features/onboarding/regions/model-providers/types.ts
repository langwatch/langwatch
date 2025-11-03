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

export interface FieldConfig {
  label: string;
  placeholder?: string;
  required: boolean;
  type?: "text" | "password" | "url";
}

export interface ModelProviderSpec {
  key: ModelProviderKey;
  label: string;
  icon: IconData;
  docs: Docs;
  fields: {
    apiKey?: FieldConfig;
    baseUrl?: FieldConfig;
    headers?: Record<string, FieldConfig>;
  };
  models: string[];
}
