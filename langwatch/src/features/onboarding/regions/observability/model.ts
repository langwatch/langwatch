export type PlatformKey =
  | "typescript"
  | "python"
  | "go"
  | "java"
  | "opentelemetry"
  | "no_and_lo";

export type FrameworkKey =
  | "vercel_ai"
  | "mastra"
  | "langgraph"
  | "langchain"
  | "llamaindex"
  | "openai"
  | "openai_agents"
  | "litellm"
  | "strands"
  | "haystack"
  | "google_adk"
  | "ollama"
  | "anthropic"
  | "gemini"
  | "agno"
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
  | "dspy";

export interface Option<T extends string> {
  key: T;
  label: string;
}
