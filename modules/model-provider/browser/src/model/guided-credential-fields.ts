/**
 * What the guided connect panel asks per provider: its short name, a one-line hint, and only
 * the credentials needed to get started (the settings drawer keeps the full list).
 * A provider with no model list types its model; Azure borrows OpenAI's chips instead.
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
  /** Whose catalog the chips come from, when the provider hosts another vendor's models. */
  modelCatalog?: string;
  /** A typed name under the chips, for a deployment named other than its model. */
  deploymentField?: GuidedDeploymentField;
};

/** The typed deployment name a provider offers under its chips. */
export type GuidedDeploymentField = { label: string; placeholder: string; hint: string };

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
    hint: "Endpoint, key and the model you deployed",
    fields: [
      {
        key: "AZURE_OPENAI_ENDPOINT",
        label: "Endpoint",
        placeholder: "https://your-resource.openai.azure.com",
        secret: false,
      },
      apiKey("", "AZURE_OPENAI_API_KEY"),
    ],
    modelCatalog: "openai",
    deploymentField: {
      label: "Deployment name",
      placeholder: "only if it differs from the model",
      hint: "Pick the model you deployed. If your deployment has a different name, type it instead.",
    },
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
    hint: "Inference API key",
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

/** The catalog a provider's guided chips are read from: its own unless it borrows one. */
export function guidedModelCatalogFor({ providerKey }: { providerKey: string }): string {
  return GUIDED_PANEL_SPECS[providerKey]?.modelCatalog ?? providerKey;
}

/** A refusal about the chosen model, not the credentials: it reads under the model field. */
export function isModelRefusal({ code }: { code: string | undefined }): boolean {
  return code === "provider_deployment_not_found";
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
