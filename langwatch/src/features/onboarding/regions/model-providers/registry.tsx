import type { ModelProviderKey, ModelProviderSpec } from "./types";
import { themedIcon, singleIcon, iconWithLabel } from "../shared/types";

export type ModelProviderRegistry = ModelProviderSpec[];

export const modelProviderRegistry: ModelProviderRegistry = [
  {
    key: "open_ai",
    backendModelProviderKey: "openai",
    label: "OpenAI",
    defaultModel: "gpt-5",
    icon: themedIcon(
      "/images/external-icons/openai-lighttheme.svg",
      "/images/external-icons/openai-darktheme.svg",
      "OpenAI"
    ),
    externalDocsUrl: "https://platform.openai.com/docs/overview",
    fieldMetadata: {
      OPENAI_API_KEY: {
        label: "OpenAI API Key",
        description: "Your OpenAI API key from platform.openai.com/api-keys",
      },
      OPENAI_BASE_URL: {
        label: "OpenAI Base URL",
        description: "Optional: Custom API endpoint for OpenAI-compatible services (e.g., Azure OpenAI proxy)",
      },
    },
  },
  {
    key: "anthropic",
    backendModelProviderKey: "anthropic",
    label: "Anthropic",
    defaultModel: "claude-sonnet-4-5",
    icon: themedIcon(
      "/images/external-icons/anthropic-lighttheme.svg",
      "/images/external-icons/anthropic-darktheme.svg",
      "Anthropic"
    ),
    externalDocsUrl: "https://docs.anthropic.com/",
    fieldMetadata: {
      ANTHROPIC_API_KEY: {
        label: "Anthropic API Key",
        description: "Your Anthropic API key from console.anthropic.com",
      },
      ANTHROPIC_BASE_URL: {
        label: "Anthropic Base URL",
        description: "Optional: Custom API endpoint for Anthropic-compatible services",
      },
    },
  },
  {
    key: "gemini",
    backendModelProviderKey: "gemini",
    label: "Google Gemini",
    defaultModel: "gemini-2.5-flash",
    icon: singleIcon("/images/external-icons/google.svg", "Google Gemini"),
    externalDocsUrl: "https://ai.google.dev/",
    fieldMetadata: {
      GEMINI_API_KEY: {
        label: "Gemini API Key",
        description: "Your Google AI Studio API key from aistudio.google.com/apikey",
      },
    },
  },
  {
    key: "open_ai_azure",
    backendModelProviderKey: "azure",
    label: "Azure OpenAI",
    defaultModel: "gpt-5",
    icon: singleIcon("/images/external-icons/ms-azure.svg", "Azure OpenAI"),
    externalDocsUrl: "https://learn.microsoft.com/azure/ai-services/openai/",
    fieldMetadata: {
      AZURE_OPENAI_API_KEY: {
        label: "API Key",
        description: "Your Azure OpenAI resource API key from Azure Portal",
      },
      AZURE_OPENAI_ENDPOINT: {
        label: "Endpoint",
        description: "Your Azure OpenAI resource endpoint URL (e.g., https://your-resource.openai.azure.com)",
      },
      AZURE_API_GATEWAY_BASE_URL: {
        label: "Base URL",
        description: "Optional: Base URL for Azure API Management gateway if routing through APIM",
      },
      AZURE_API_GATEWAY_VERSION: {
        label: "Version",
        description: "Optional: API version for Azure API Management gateway",
      },
    },
  },
  {
    key: "aws_bedrock",
    backendModelProviderKey: "bedrock",
    label: "AWS Bedrock",
    icon: themedIcon(
      "/images/external-icons/aws-lighttheme.svg",
      "/images/external-icons/aws-darktheme.svg",
      "AWS Bedrock",
    ),
    externalDocsUrl: "https://aws.amazon.com/bedrock/",
    fieldMetadata: {
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
  },
  {
    key: "deepseek",
    backendModelProviderKey: "deepseek",
    label: "DeepSeek",
    defaultModel: "deepseek-r1",
    icon: singleIcon("/images/external-icons/deepseek.svg", "DeepSeek"),
    externalDocsUrl: "https://www.deepseek.com/",
    fieldMetadata: {
      DEEPSEEK_API_KEY: {
        label: "API Key",
        description: "Your DeepSeek API key from platform.deepseek.com",
      },
    },
  },
  {
    key: "groq",
    backendModelProviderKey: "groq",
    label: "Groq",
    icon: singleIcon("/images/external-icons/groq.svg", "Groq"),
    externalDocsUrl: "https://groq.com/",
    fieldMetadata: {
      GROQ_API_KEY: {
        label: "API Key",
        description: "Your Groq API key from console.groq.com",
      },
    },
  },
  {
    key: "grok_xai",
    backendModelProviderKey: "xai",
    label: "Grok (xAI)",
    defaultModel: "grok-4",
    icon: themedIcon(
      "/images/external-icons/grok-lighttheme.svg",
      "/images/external-icons/grok-darktheme.svg",
      "Grok"
    ),
    externalDocsUrl: "https://x.ai/",
    fieldMetadata: {
      XAI_API_KEY: {
        label: "API Key",
        description: "Your xAI API key from x.ai",
      },
    },
  },
  {
    key: "vertex_ai",
    backendModelProviderKey: "vertex_ai",
    label: "Google Vertex AI",
    icon: singleIcon("/images/external-icons/gcloud.svg", "Google Vertex AI"),
    externalDocsUrl: "https://cloud.google.com/vertex-ai",
    fieldMetadata: {
      GOOGLE_APPLICATION_CREDENTIALS: {
        label: "Google Service Account JSON",
        description: "Paste the contents of your Google Cloud service account JSON file. Create one in GCP Console > IAM & Admin > Service Accounts with Vertex AI permissions.",
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
  },
  {
    key: "cerebras",
    backendModelProviderKey: "cerebras",
    label: "Cerebras",
    icon: themedIcon(
      "/images/external-icons/cerebras-lighttheme.svg",
      "/images/external-icons/cerebras-darktheme.svg",
      "Cerebras",
    ),
    externalDocsUrl: "https://cerebras.ai/",
    fieldMetadata: {
      CEREBRAS_API_KEY: {
        label: "API Key",
        description: "Your Cerebras API key from cloud.cerebras.ai",
      },
    },
  },
  {
    key: "custom",
    backendModelProviderKey: "custom",
    label: "Custom, OpenAI-compatible",
    icon: iconWithLabel(
      singleIcon("/images/external-icons/custom.svg", "Custom Provider"),
      "Custom"
    ),
    fieldMetadata: {
      CUSTOM_API_KEY: {
        label: "API Key",
        description: "Optional: API key for your custom OpenAI-compatible endpoint",
      },
      CUSTOM_BASE_URL: {
        label: "Base URL",
        description: "Your custom API endpoint URL (e.g., LiteLLM proxy, vLLM server, or any /chat/completions compatible service)",
      },
    },
  },
];

export function getModelProvider(key: ModelProviderKey): ModelProviderSpec | undefined {
  return modelProviderRegistry.find((provider) => provider.key === key);
}
