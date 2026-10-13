/**
 * Field name stays the provider's own env var (matches the customer's `.env`); `description`
 * carries the "where to get one" prose the form reads. Keyed by backend provider key, which
 * sometimes differs from the onboarding tile's key (e.g. `open_ai_azure` vs `azure`).
 */

export type ModelProviderFieldMetadata = {
  label: string;
  description?: string;
};

export const MODEL_PROVIDER_FIELD_METADATA: Record<
  string,
  Record<string, ModelProviderFieldMetadata>
> = {
  openai: {
    OPENAI_API_KEY: {
      label: "OpenAI API Key",
      description: "Your OpenAI API key from platform.openai.com/api-keys",
    },
    OPENAI_BASE_URL: {
      label: "OpenAI Base URL",
      description:
        "Optional: Custom API endpoint for OpenAI-compatible services (e.g., Azure OpenAI proxy)",
    },
  },
  anthropic: {
    ANTHROPIC_API_KEY: {
      label: "Anthropic API Key",
      description: "Your Anthropic API key from console.anthropic.com",
    },
    ANTHROPIC_BASE_URL: {
      label: "Anthropic Base URL",
      description: "Optional: Custom API endpoint for Anthropic-compatible services",
    },
  },
  gemini: {
    GEMINI_API_KEY: {
      label: "Gemini API Key",
      // One field for either kind of Google key. An Agent Platform key is
      // detected when Google refuses it on the Gemini API with a
      // restriction naming another service; the customer is then asked
      // for the two extra fields below rather than being told the key is
      // invalid. See specs/model-providers/google-agent-platform.feature.
      description:
        "Your Google AI Studio key, or a Google Cloud key for Gemini — including one restricted to Gemini Enterprise Agent Platform.",
    },
    GEMINI_PROJECT: {
      label: "Google Cloud Project",
      description:
        "Only for Agent Platform keys: the project the key belongs to. Its number appears in the error Google returns if the key is used against the wrong service.",
    },
    GEMINI_LOCATION: {
      label: "Location",
      description:
        "Only for Agent Platform keys: where to serve the model from — 'global', or a region such as us-central1.",
    },
  },
  azure: {
    AZURE_OPENAI_API_KEY: {
      label: "API Key",
      description: "Your Azure OpenAI resource API key from Azure Portal",
    },
    AZURE_OPENAI_ENDPOINT: {
      label: "Endpoint",
      description:
        "Your Azure OpenAI resource endpoint URL (e.g., https://your-resource.openai.azure.com)",
    },
    AZURE_OPENAI_API_VERSION: {
      label: "API Version",
      description:
        "Optional: used when calling your Azure OpenAI resource directly. It is ignored when your traffic routes through the LangWatch AI Gateway, which sets its own version.",
    },
    AZURE_API_GATEWAY_BASE_URL: {
      label: "Base URL",
      description: "Optional: Base URL for Azure API Management gateway if routing through APIM",
    },
    AZURE_API_GATEWAY_VERSION: {
      label: "Version",
      description:
        "Optional: used when calling through your Azure API Management gateway. It is ignored when your traffic routes through the LangWatch AI Gateway, which sets its own version.",
    },
  },
  bedrock: {
    AWS_ACCESS_KEY_ID: {
      label: "Access Key ID",
      description: "Your AWS IAM access key ID with Bedrock permissions",
    },
    AWS_SECRET_ACCESS_KEY: {
      label: "Secret Access Key",
      description: "Your AWS IAM secret access key",
    },
    AWS_REGION_NAME: {
      label: "Region",
      description: "The AWS region where Bedrock is available (e.g., us-east-1, us-west-2)",
    },
  },
  deepseek: {
    DEEPSEEK_API_KEY: {
      label: "API Key",
      description: "Your DeepSeek API key from platform.deepseek.com",
    },
  },
  groq: {
    GROQ_API_KEY: {
      label: "API Key",
      description: "Your Groq API key from console.groq.com",
    },
  },
  xai: {
    XAI_API_KEY: {
      label: "API Key",
      description: "Your xAI API key from x.ai",
    },
  },
  vertex_ai: {
    GOOGLE_APPLICATION_CREDENTIALS: {
      label: "Google Service Account JSON",
      description:
        "Paste the contents of your Google Cloud service account JSON file. Create one in GCP Console > IAM & Admin > Service Accounts with Vertex AI permissions.",
    },
    VERTEXAI_PROJECT: {
      label: "Vertex Project ID",
      description: "Your Google Cloud project ID where Vertex AI is enabled",
    },
    VERTEXAI_LOCATION: {
      label: "Vertex Location",
      description: "The GCP region for Vertex AI (e.g., us-central1, europe-west1)",
    },
  },
  cerebras: {
    CEREBRAS_API_KEY: {
      label: "API Key",
      description: "Your Cerebras API key from cloud.cerebras.ai",
    },
  },
  custom: {
    CUSTOM_API_KEY: {
      label: "API Key",
      description: "Optional: API key for your custom OpenAI-compatible endpoint",
    },
    CUSTOM_BASE_URL: {
      label: "Base URL",
      description:
        "Your custom API endpoint URL (e.g., LiteLLM proxy, vLLM server, or any /chat/completions compatible service)",
    },
  },
};

/** The labels and hints for one provider's credential fields, if we have any. */
export function fieldMetadataFor(
  backendProviderKey: string,
): Record<string, ModelProviderFieldMetadata> | undefined {
  return MODEL_PROVIDER_FIELD_METADATA[backendProviderKey];
}
