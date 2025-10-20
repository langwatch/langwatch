import type React from "react";
import type { IconProps } from "@chakra-ui/react";

export type PlatformKey = "typescript" | "python" | "go" | "opentelemetry" | "no_and_lo" | "other";

export type FrameworkKey =
  | "vercel_ai"
  | "mastra"
  | "langchain"
  | "openai"
  | "litellm"
  | "strands"
  | "haystack"
  | "google_adk"
  | "ollama"
  | "anthropic"
  | "gemini"
  | "grok"
  | "azure"
  | "opentelemetry"
  | "n8n"
  | "langflow"
  | "mistral"
  | "flowise"
  | "crewai"
  | "pydantic"
  | "spring"
  | "groq"
  | "openrouter"
  | "semantic_kernel"
  | "smol_agents"
  | "dspy"
  ;

export interface Option<T extends string> {
  key: T;
  label: string;
  icon?: React.ReactNode;
  size?: IconProps["size"];
}
