/**
 * What the guided connect panel asks per provider: its short name, a one-line hint, and only
 * the credentials needed to get started (the settings drawer keeps the full list).
 * Providers with no readable model list carry the typed model's placeholder.
 */

export type GuidedCredentialField = {
  /** The custom key the provider's schema knows, e.g. OPENAI_API_KEY. */
  key: string;
  label: string;
  placeholder: string;
  secret: boolean;
  /** Custom endpoints may run without a key. */
  optional?: boolean;
};

export type GuidedPanelSpec = {
  name: string;
  hint: string;
  fields: GuidedCredentialField[];
  modelPlaceholder?: string;
};

const apiKey = (placeholder: string, key: string): GuidedCredentialField => ({
  key,
  label: "API key",
  placeholder,
  secret: true,
});

export const GUIDED_PANEL_SPECS: Record<string, GuidedPanelSpec> = {
  openai_codex: {
    name: "Codex",
    hint: "Sign in with your ChatGPT account, no API key needed",
    fields: [],
  },
  openai: {
    name: "OpenAI",
    hint: "Platform API key",
    fields: [apiKey("sk-...", "OPENAI_API_KEY")],
  },
  anthropic: {
    name: "Anthropic",
    hint: "Console API key",
    fields: [apiKey("sk-ant-...", "ANTHROPIC_API_KEY")],
  },
  gemini: {
    name: "Gemini",
    hint: "AI Studio API key",
    fields: [apiKey("AIza...", "GEMINI_API_KEY")],
  },
  azure: {
    name: "Azure",
    hint: "Endpoint, key and your deployment name",
    fields: [
      {
        key: "AZURE_OPENAI_ENDPOINT",
        label: "Endpoint",
        placeholder: "https://your-resource.openai.azure.com",
        secret: false,
      },
      apiKey("", "AZURE_OPENAI_API_KEY"),
    ],
    modelPlaceholder: "your deployment name",
  },
  bedrock: {
    name: "Bedrock",
    hint: "IAM credentials and the model id you enabled",
    fields: [
      { key: "AWS_ACCESS_KEY_ID", label: "Access key ID", placeholder: "AKIA...", secret: false },
      { key: "AWS_SECRET_ACCESS_KEY", label: "Secret access key", placeholder: "", secret: true },
      { key: "AWS_REGION_NAME", label: "Region", placeholder: "us-east-1", secret: false },
    ],
    modelPlaceholder: "e.g. anthropic.claude-sonnet-4-5",
  },
  deepseek: {
    name: "DeepSeek",
    hint: "Platform API key",
    fields: [apiKey("sk-...", "DEEPSEEK_API_KEY")],
  },
  doubleword: {
    name: "Doubleword",
    hint: "Platform API key",
    fields: [apiKey("sk-...", "DOUBLEWORD_API_KEY")],
  },
  groq: { name: "Groq", hint: "Console API key", fields: [apiKey("gsk_...", "GROQ_API_KEY")] },
  custom: {
    name: "Custom",
    hint: "Any OpenAI-compatible endpoint",
    fields: [
      {
        key: "CUSTOM_BASE_URL",
        label: "Base URL",
        placeholder: "https://llm.internal.acme.dev/v1",
        secret: false,
      },
      { ...apiKey("", "CUSTOM_API_KEY"), optional: true },
    ],
    modelPlaceholder: "e.g. acme-llm-large",
  },
};

/** The guided panel for a provider; one the guided list does not curate gets its API key only. */
export function guidedPanelSpecFor({
  providerKey,
  providerName,
  apiKeyField,
}: {
  providerKey: string;
  providerName: string;
  apiKeyField: string | undefined;
}): GuidedPanelSpec {
  const curated = GUIDED_PANEL_SPECS[providerKey];
  if (curated) return curated;
  return {
    name: providerName,
    hint: "API key",
    fields: apiKeyField ? [apiKey("", apiKeyField)] : [],
  };
}

/** Every required field typed: what makes Connect clickable. */
export function areGuidedFieldsFilled({
  fields,
  values,
}: {
  fields: GuidedCredentialField[];
  values: Record<string, string>;
}): boolean {
  return fields.every((field) => field.optional || Boolean(values[field.key]?.trim()));
}
