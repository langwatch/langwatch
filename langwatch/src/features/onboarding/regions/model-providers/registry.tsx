import type { ModelProviderKey, ModelProviderSpec } from "./types";
import { themedIcon, singleIcon } from "../shared/types";

export type ModelProviderRegistry = ModelProviderSpec[];

export const modelProviderRegistry: ModelProviderRegistry = [
  {
    key: "open_ai",
    label: "OpenAI",
    icon: themedIcon(
      "/images/external-icons/openai-lighttheme.svg",
      "/images/external-icons/openai-darktheme.svg",
      "OpenAI"
    ),
    docs: {
      internal: "/settings/model-providers",
      external: "https://platform.openai.com/docs/overview",
    },
    fields: {
      apiKey: {
        label: "OPENAI_API_KEY",
        required: true,
        type: "password",
      },
      baseUrl: {
        label: "OPENAI_BASE_URL",
        placeholder: "optional",
        required: false,
        type: "url",
      },
    },
    models: [
      "gpt-4",
      "gpt-4-turbo",
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-3.5-turbo",
      "o1",
      "o1-mini",
      "o1-preview",
      "o3-mini",
    ],
  },
  {
    key: "anthropic",
    label: "Anthropic",
    icon: themedIcon(
      "/images/external-icons/anthropic-lighttheme.svg",
      "/images/external-icons/anthropic-darktheme.svg",
      "Anthropic"
    ),
    docs: {
      internal: "/settings/model-providers",
      external: "https://docs.anthropic.com/",
    },
    fields: {
      apiKey: {
        label: "ANTHROPIC_API_KEY",
        required: true,
        type: "password",
      },
    },
    models: [
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-20240229",
      "claude-3-sonnet-20240229",
      "claude-3-haiku-20240307",
    ],
  },
  {
    key: "gemini",
    label: "Google Gemini",
    icon: singleIcon("/images/external-icons/google.svg", "Google Gemini"),
    docs: {
      internal: "/settings/model-providers",
      external: "https://ai.google.dev/",
    },
    fields: {
      apiKey: {
        label: "GEMINI_API_KEY",
        required: true,
        type: "password",
      },
    },
    models: [
      "gemini-1.5-pro",
      "gemini-1.5-flash",
      "gemini-1.0-pro",
      "gemini-2.0-flash-exp",
    ],
  },
  {
    key: "open_ai_azure",
    label: "Azure OpenAI",
    icon: singleIcon("/images/external-icons/azure.svg", "Azure OpenAI"),
    docs: {
      internal: "/settings/model-providers",
      external: "https://learn.microsoft.com/azure/ai-services/openai/",
    },
    fields: {
      apiKey: {
        label: "AZURE_OPENAI_API_KEY",
        required: true,
        type: "password",
      },
      baseUrl: {
        label: "AZURE_OPENAI_ENDPOINT",
        placeholder: "https://your-resource.openai.azure.com",
        required: true,
        type: "url",
      },
    },
    models: ["gpt-4", "gpt-4-turbo", "gpt-4o", "gpt-35-turbo"],
  },
  {
    key: "grok_xai",
    label: "Grok (xAI)",
    icon: themedIcon(
      "/images/external-icons/grok-lighttheme.svg",
      "/images/external-icons/grok-darktheme.svg",
      "Grok"
    ),
    docs: {
      internal: "/settings/model-providers",
      external: "https://x.ai/",
    },
    fields: {
      apiKey: {
        label: "XAI_API_KEY",
        required: true,
        type: "password",
      },
    },
    models: ["grok-beta", "grok-vision-beta"],
  },
  {
    key: "groq",
    label: "Groq",
    icon: singleIcon("/images/external-icons/groq.svg", "Groq"),
    docs: {
      internal: "/settings/model-providers",
      external: "https://groq.com/",
    },
    fields: {
      apiKey: {
        label: "GROQ_API_KEY",
        required: true,
        type: "password",
      },
    },
    models: [
      "llama-3.1-70b-versatile",
      "llama-3.1-8b-instant",
      "llama-3.2-90b-vision-preview",
      "mixtral-8x7b-32768",
    ],
  },
  {
    key: "aws_bedrock",
    label: "AWS Bedrock",
    icon: singleIcon("/images/external-icons/aws.svg", "AWS Bedrock"),
    docs: {
      internal: "/settings/model-providers",
      external: "https://aws.amazon.com/bedrock/",
    },
    fields: {
      apiKey: {
        label: "AWS_ACCESS_KEY_ID",
        required: true,
        type: "password",
      },
      headers: {
        AWS_SECRET_ACCESS_KEY: {
          label: "AWS_SECRET_ACCESS_KEY",
          required: true,
          type: "password",
        },
        AWS_REGION: {
          label: "AWS_REGION",
          placeholder: "us-east-1",
          required: true,
          type: "text",
        },
      },
    },
    models: [
      "anthropic.claude-3-5-sonnet-20241022-v2:0",
      "anthropic.claude-3-opus-20240229-v1:0",
      "meta.llama3-1-70b-instruct-v1:0",
      "amazon.titan-text-premier-v1:0",
    ],
  },
  {
    key: "vertex_ai",
    label: "Google Vertex AI",
    icon: singleIcon("/images/external-icons/gcloud.svg", "Google Vertex AI"),
    docs: {
      internal: "/settings/model-providers",
      external: "https://cloud.google.com/vertex-ai",
    },
    fields: {
      apiKey: {
        label: "VERTEX_AI_PROJECT_ID",
        required: true,
        type: "text",
      },
      headers: {
        VERTEX_AI_LOCATION: {
          label: "VERTEX_AI_LOCATION",
          placeholder: "us-central1",
          required: true,
          type: "text",
        },
      },
    },
    models: [
      "gemini-1.5-pro",
      "gemini-1.5-flash",
      "claude-3-5-sonnet-v2",
      "claude-3-opus",
    ],
  },
  {
    key: "deepseek",
    label: "DeepSeek",
    icon: singleIcon("/images/external-icons/deepseek.svg", "DeepSeek"),
    docs: {
      internal: "/settings/model-providers",
      external: "https://www.deepseek.com/",
    },
    fields: {
      apiKey: {
        label: "DEEPSEEK_API_KEY",
        required: true,
        type: "password",
      },
    },
    models: ["deepseek-chat", "deepseek-coder"],
  },
  {
    key: "cerebras",
    label: "Cerebras",
    icon: singleIcon("/images/external-icons/cerebras.svg", "Cerebras"),
    docs: {
      internal: "/settings/model-providers",
      external: "https://cerebras.ai/",
    },
    fields: {
      apiKey: {
        label: "CEREBRAS_API_KEY",
        required: true,
        type: "password",
      },
    },
    models: ["llama3.1-8b", "llama3.1-70b"],
  },
  {
    key: "custom",
    label: "Custom (OpenAI-compatible)",
    icon: singleIcon("/images/external-icons/custom.svg", "Custom Provider"),
    docs: {
      internal: "/settings/model-providers",
    },
    fields: {
      apiKey: {
        label: "CUSTOM_API_KEY",
        required: true,
        type: "password",
      },
      baseUrl: {
        label: "CUSTOM_BASE_URL",
        placeholder: "https://openai.inference.de-txl.cloud.ovh.net/v1",
        required: true,
        type: "url",
      },
    },
    models: [],
  },
];

export function getModelProvider(key: ModelProviderKey): ModelProviderSpec | undefined {
  return modelProviderRegistry.find((provider) => provider.key === key);
}
