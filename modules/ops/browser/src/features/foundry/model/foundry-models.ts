export const LLM_MODELS = [
  { label: "GPT-4o", value: "gpt-4o" },
  { label: "GPT-4o Mini", value: "gpt-4o-mini" },
  { label: "GPT-4.1", value: "gpt-4.1" },
  { label: "GPT-4.1 Mini", value: "gpt-4.1-mini" },
  { label: "GPT-5 Mini", value: "gpt-5-mini" },
  { label: "o3", value: "o3" },
  { label: "o4-mini", value: "o4-mini" },
  { label: "Claude Opus 4", value: "claude-opus-4-20250514" },
  { label: "Claude Sonnet 4", value: "claude-sonnet-4-20250514" },
  { label: "Claude Haiku 3.5", value: "claude-3-5-haiku-20241022" },
  { label: "Gemini 2.5 Pro", value: "gemini-2.5-pro" },
  { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash" },
  { label: "Grok 3", value: "grok-3" },
  { label: "Grok 3 Mini", value: "grok-3-mini" },
  { label: "Llama 4 Scout", value: "meta-llama/llama-4-scout" },
  { label: "DeepSeek V3", value: "deepseek-chat" },
  { label: "DeepSeek R1", value: "deepseek-reasoner" },
  { label: "Mistral Large", value: "mistral-large-latest" },
] as const;

export const AI_PROVIDERS = [
  { label: "OpenAI", value: "openai", baseUrl: "https://api.openai.com/v1" },
  { label: "xAI (Grok)", value: "xai", baseUrl: "https://api.x.ai/v1" },
  {
    label: "Anthropic",
    value: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
  },
] as const;
