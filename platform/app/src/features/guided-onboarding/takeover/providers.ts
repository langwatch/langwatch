import {
  getModelProvider,
  modelProviderRegistry,
} from "~/features/onboarding/regions/model-providers/registry";
import type {
  ModelProviderKey,
  ModelProviderSpec,
} from "~/features/onboarding/regions/model-providers/types";
import { getProviderModelOptions } from "~/server/modelProviders/registry";

/**
 * The providers the guided onboarding offers, in the order the marks row
 * shows them. Codex signs in with the user's ChatGPT account; API-key
 * providers take a key with the default chat model already picked; Azure,
 * Bedrock and Custom also ask for the model name, since there is no list to
 * offer before the credentials work.
 *
 * Each entry points at the shared provider registry for its backend key,
 * icon and field metadata; what lives here is the guided screen's own copy.
 */

export type GuidedProviderKind = "oauth" | "api-key" | "manual";

export interface GuidedCredentialField {
  /** The custom key the provider's schema knows, e.g. OPENAI_API_KEY. */
  key: string;
  label: string;
  placeholder: string;
  secret: boolean;
  /** Custom endpoints may run without a key. */
  optional?: boolean;
}

export interface GuidedProvider {
  id:
    | "codex"
    | "openai"
    | "anthropic"
    | "gemini"
    | "azure"
    | "bedrock"
    | "deepseek"
    | "groq"
    | "custom";
  registryKey: ModelProviderKey;
  name: string;
  kind: GuidedProviderKind;
  hint: string;
  fields: GuidedCredentialField[];
  /** The typed model's placeholder, for the providers with no model list. */
  modelPlaceholder?: string;
}

export const GUIDED_PROVIDERS: GuidedProvider[] = [
  {
    id: "codex",
    registryKey: "codex",
    name: "Codex",
    kind: "oauth",
    hint: "Sign in with your ChatGPT account, no API key needed",
    fields: [],
  },
  {
    id: "openai",
    registryKey: "open_ai",
    name: "OpenAI",
    kind: "api-key",
    hint: "Platform API key",
    fields: [
      {
        key: "OPENAI_API_KEY",
        label: "API key",
        placeholder: "sk-...",
        secret: true,
      },
    ],
  },
  {
    id: "anthropic",
    registryKey: "anthropic",
    name: "Anthropic",
    kind: "api-key",
    hint: "Console API key",
    fields: [
      {
        key: "ANTHROPIC_API_KEY",
        label: "API key",
        placeholder: "sk-ant-...",
        secret: true,
      },
    ],
  },
  {
    id: "gemini",
    registryKey: "gemini",
    name: "Gemini",
    kind: "api-key",
    hint: "AI Studio API key",
    fields: [
      {
        key: "GEMINI_API_KEY",
        label: "API key",
        placeholder: "AIza...",
        secret: true,
      },
    ],
  },
  {
    id: "azure",
    registryKey: "open_ai_azure",
    name: "Azure",
    kind: "manual",
    hint: "Endpoint, key and your deployment name",
    fields: [
      {
        key: "AZURE_OPENAI_ENDPOINT",
        label: "Endpoint",
        placeholder: "https://your-resource.openai.azure.com",
        secret: false,
      },
      {
        key: "AZURE_OPENAI_API_KEY",
        label: "API key",
        placeholder: "",
        secret: true,
      },
    ],
    modelPlaceholder: "your deployment name",
  },
  {
    id: "bedrock",
    registryKey: "aws_bedrock",
    name: "Bedrock",
    kind: "manual",
    hint: "IAM credentials and the model id you enabled",
    fields: [
      {
        key: "AWS_ACCESS_KEY_ID",
        label: "Access key ID",
        placeholder: "AKIA...",
        secret: false,
      },
      {
        key: "AWS_SECRET_ACCESS_KEY",
        label: "Secret access key",
        placeholder: "",
        secret: true,
      },
      {
        key: "AWS_REGION_NAME",
        label: "Region",
        placeholder: "us-east-1",
        secret: false,
      },
    ],
    modelPlaceholder: "e.g. anthropic.claude-sonnet-4-5",
  },
  {
    id: "deepseek",
    registryKey: "deepseek",
    name: "DeepSeek",
    kind: "api-key",
    hint: "Platform API key",
    fields: [
      {
        key: "DEEPSEEK_API_KEY",
        label: "API key",
        placeholder: "sk-...",
        secret: true,
      },
    ],
  },
  {
    id: "groq",
    registryKey: "groq",
    name: "Groq",
    kind: "api-key",
    hint: "Console API key",
    fields: [
      {
        key: "GROQ_API_KEY",
        label: "API key",
        placeholder: "gsk_...",
        secret: true,
      },
    ],
  },
  {
    id: "custom",
    registryKey: "custom",
    name: "Custom",
    kind: "manual",
    hint: "Any OpenAI-compatible endpoint",
    fields: [
      {
        key: "CUSTOM_BASE_URL",
        label: "Base URL",
        placeholder: "https://llm.internal.acme.dev/v1",
        secret: false,
      },
      {
        key: "CUSTOM_API_KEY",
        label: "API key",
        placeholder: "",
        secret: true,
        optional: true,
      },
    ],
    modelPlaceholder: "e.g. acme-llm-large",
  },
];

/** At most this many chat model pills: the recommended one and the next few. */
export const GUIDED_MODEL_PILLS_MAX = 4;

/**
 * The providers offered on this install: the registry's per-surface rules
 * apply, and Codex only where its sign-in is available.
 */
export function guidedProvidersFor({
  codexAvailable,
}: {
  codexAvailable: boolean;
}): GuidedProvider[] {
  return GUIDED_PROVIDERS.filter((p) => {
    if (p.kind === "oauth" && !codexAvailable) return false;
    const spec = getModelProvider(p.registryKey);
    return !spec?.hiddenOn?.includes("guided");
  });
}

export function registrySpecFor(provider: GuidedProvider): ModelProviderSpec {
  const spec = getModelProvider(provider.registryKey);
  if (!spec) {
    throw new Error(
      `guided provider ${provider.id} points at an unknown registry key ${provider.registryKey}`,
    );
  }
  return spec;
}

/**
 * The chat model pills for an API-key provider: the registry's default model
 * first (that one is "recommended"), then the catalog's other chat models,
 * capped so the row stays one line.
 */
export function guidedChatModels(provider: GuidedProvider): string[] {
  const spec = registrySpecFor(provider);
  const catalog = getProviderModelOptions(
    spec.backendModelProviderKey,
    "chat",
  ).map((option) => option.value);
  const ordered = spec.defaultModel
    ? [spec.defaultModel, ...catalog.filter((m) => m !== spec.defaultModel)]
    : catalog;
  return ordered.slice(0, GUIDED_MODEL_PILLS_MAX);
}

export function guidedProviderIcon(provider: GuidedProvider) {
  return registrySpecFor(provider).icon;
}

/** Every guided provider resolves in the registry; pinned by a test. */
export function guidedProviderRegistryKeys(): ModelProviderKey[] {
  return modelProviderRegistry.map((spec) => spec.key);
}
