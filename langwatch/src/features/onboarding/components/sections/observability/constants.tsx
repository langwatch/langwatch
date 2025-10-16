import type { FrameworkKey, PlatformKey, Option } from "./types";

export const PLATFORM_OPTIONS: Option<PlatformKey>[] = [
  { key: "typescript", label: "TypeScript", icon: <img src="/images/external-icons/typescript.svg" alt="TypeScript" /> },
  { key: "python", label: "Python", icon: <img src="/images/external-icons/python.svg" alt="Python" /> },
  { key: "go", label: "Go", icon: <img src="/images/external-icons/golang.svg" alt="Go" /> },
  { key: "opentelemetry", label: "OpenTelemetry", icon: <img src="/images/external-icons/otel.svg" alt="OpenTelemetry" /> },
  { key: "no_and_lo", label: "No and Low Code", icon: <img src="/images/external-icons/no-and-lo.svg" alt="No and Low Code" /> },
  { key: "other", label: "Other" },
];

export const FRAMEWORKS_BY_PLATFORM: Partial<Record<PlatformKey, Option<FrameworkKey>[]>> = {
  typescript: [
    { key: "vercel_ai", label: "Vercel AI", icon: <img src="/images/external-icons/vercel-darktheme.svg" alt="Vercel AI" />, size: "2xl" },
    { key: "mastra", label: "Mastra", icon: <img src="/images/external-icons/mastra-darktheme.svg" alt="Mastra" />, size: "2xl" },
    { key: "langchain", label: "LangChain", icon: <img src="/images/external-icons/langchain-darktheme.svg" alt="LangChain" />, size: "2xl" },
    { key: "openai", label: "OpenAI", icon: <img src="/images/external-icons/openai-darktheme.svg" alt="OpenAI" />, size: "xl" },
    { key: "azure", label: "Azure", icon: <img src="/images/external-icons/azure.svg" alt="Azure" /> },
    { key: "anthropic", label: "Anthropic", icon: <img src="/images/external-icons/anthropic-darktheme.svg" alt="Anthropic" /> },
    { key: "gemini", label: "Gemini", icon: <img src="/images/external-icons/google.svg" alt="Gemini" /> },
    { key: "grok", label: "Grok", icon: <img src="/images/external-icons/grok-darktheme.svg" alt="Grok" />, size: "xl" },
  ],
  python: [
    { key: "langchain", label: "LangChain", icon: <img src="/images/external-icons/langchain-darktheme.svg" alt="LangChain" />, size: "2xl" },
    { key: "google_adk", label: "Google ADK", icon: <img src="/images/external-icons/google.svg" alt="Google ADK" /> },
    { key: "openai", label: "OpenAI", icon: <img src="/images/external-icons/openai-darktheme.svg" alt="OpenAI" />, size: "xl" },
    { key: "anthropic", label: "Anthropic", icon: <img src="/images/external-icons/anthropic-darktheme.svg" alt="Anthropic" /> },
    { key: "gemini", label: "Gemini", icon: <img src="/images/external-icons/google.svg" alt="Gemini" /> },
    { key: "grok", label: "Grok", icon: <img src="/images/external-icons/grok-darktheme.svg" alt="Grok" />, size: "2xl" },
    { key: "azure", label: "Azure", icon: <img src="/images/external-icons/azure.svg" alt="Azure" /> },
    { key: "ollama", label: "Ollama", icon: <img src="/images/external-icons/ollama-darktheme.svg" alt="Ollama" /> },
    { key: "strands", label: "Strands", icon: <img src="/images/external-icons/strands.svg" alt="Strands" /> },
    { key: "haystack", label: "Haystack", icon: <img src="/images/external-icons/haystack.png" alt="Haystack" /> },
    { key: "litellm", label: "Litellm", icon: <img src="/images/external-icons/litellm.avif" alt="Litellm" /> },
    { key: "mistral", label: "Mistral", icon: <img src="/images/external-icons/mistral.svg" alt="Mistral" /> },
    { key: "crewai", label: "CrewAI", icon: <img src="/images/external-icons/crewai.svg" alt="CrewAI" /> },
    { key: "pydantic", label: "Pydantic", icon: <img src="/images/external-icons/pydanticai.svg" alt="Pydantic" /> },
    { key: "groq", label: "Groq", icon: <img src="/images/external-icons/groq.svg" alt="Groq" /> },
    { key: "openrouter", label: "OpenRouter", icon: <img src="/images/external-icons/openrouter-darktheme.svg" alt="OpenRouter" /> },
    { key: "semantic_kernel", label: "Semantic Kernel", icon: <img src="/images/external-icons/semantic-kernel.png" alt="Semantic Kernel" /> },
    { key: "smol_agents", label: "Smol Agents", icon: <img src="/images/external-icons/smol-agents.png" alt="Smol Agents" /> },
    { key: "dspy", label: "Dspy", icon: <img src="/images/external-icons/dspy.webp" alt="Dspy" /> },
  ],
  go: [
    { key: "mistral", label: "Mistral", icon: <img src="/images/external-icons/mistral.svg" alt="Mistral" /> },
    { key: "grok", label: "Grok", icon: <img src="/images/external-icons/grok-darktheme.svg" alt="Grok" />, size: "xl" },
    { key: "anthropic", label: "Anthropic", icon: <img src="/images/external-icons/anthropic-darktheme.svg" alt="Anthropic" />  },
    { key: "gemini", label: "Gemini", icon: <img src="/images/external-icons/google.svg" alt="Gemini" /> },
    { key: "ollama", label: "Ollama", icon: <img src="/images/external-icons/ollama-darktheme.svg" alt="Ollama" /> },
    { key: "azure", label: "Azure", icon: <img src="/images/external-icons/azure.svg" alt="Azure" /> },
    { key: "openai", label: "OpenAI", icon: <img src="/images/external-icons/openai-darktheme.svg" alt="OpenAI" />, size: "xl" },
  ],
  opentelemetry: [],
  no_and_lo: [
    { key: "n8n", label: "n8n", icon: <img src="/images/external-icons/n8n.svg" alt="n8n" /> },
    { key: "langflow", label: "Langflow", icon: <img src="/images/external-icons/langflow.svg" alt="Langflow" /> },
    { key: "flowise", label: "Flowise", icon: <img src="/images/external-icons/flowise.svg" alt="Flowise" /> },
  ],
};

export function platformToFileName(key: PlatformKey): string {
  switch (key) {
    case "typescript":
      return "app.ts";
    case "python":
      return "app.py";
    case "go":
      return "main.go";
    case "opentelemetry":
      return "opentelemetry.yaml";
    default:
      return "";
  }
}


