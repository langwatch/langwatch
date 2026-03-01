/* eslint-disable @next/next/no-img-element */

import { FlowiseSetup } from "../../../components/sections/observability/FlowiseSetup";
import { LangflowSetup } from "../../../components/sections/observability/LangflowSetup";
import { OpenTelemetrySetup } from "../../../components/sections/observability/OpenTelemetrySetup";
import type { Docs, IconData } from "../../shared/types";
import { iconWithLabel, singleIcon, themedIcon } from "../../shared/types";
import type { FrameworkKey, PlatformKey } from "../types";
import goAnthropicSource from "./snippets/go/anthropic.snippet.go";
import goAzureSource from "./snippets/go/azure.snippet.go";
import goGeminiSource from "./snippets/go/gemini.snippet.go";
import goGrokSource from "./snippets/go/grok.snippet.go";
import goGroqSource from "./snippets/go/groq.snippet.go";
import goMistralSource from "./snippets/go/mistral.snippet.go";
import goOllamaSource from "./snippets/go/ollama.snippet.go";
import goOpenaiSource from "./snippets/go/openai.snippet.go";
import springAiYamlSource from "./snippets/java/springai.snippet.yaml";
import n8nBashSource from "./snippets/noandlo/n8n.snippet.sh";
import agnoPySource from "./snippets/python/agno.snippet.py";
import anthropicPySource from "./snippets/python/anthropic.snippet.py";
import dspyPySource from "./snippets/python/dspy.snippet.py";
import haystackPySource from "./snippets/python/haystack.snippet.py";
import langchainPySource from "./snippets/python/langchain.snippet.py";
import langgraphPySource from "./snippets/python/langgraph.snippet.py";
import litellmPySource from "./snippets/python/litellm.snippet.py";
import openaiPySource from "./snippets/python/openai.snippet.py";
import openaiAgentsPySource from "./snippets/python/openaiagents.snippet.py";
import pydanticPySource from "./snippets/python/pydanticai.snippet.py";
import strandsPySource from "./snippets/python/strandsagents.snippet.py";
import langchainTsSource from "./snippets/typescript/langchain.snippet.sts";
import langgraphTsSource from "./snippets/typescript/langgraph.snippet.sts";
import mastraTsSource from "./snippets/typescript/mastra.snippet.sts";
import openaiTsSource from "./snippets/typescript/openai.snippet.sts";
import vercelAiTsSource from "./snippets/typescript/vercelai.snippet.sts";

export interface InstallMatrix {
  js?: { npm: string; pnpm: string; yarn: string; bun: string };
  python?: { pip: string; uv: string };
  go?: { "go get": string };
}

export interface SnippetRef {
  file: string;
  language: string;
  filename: string;
}

export interface IntegrationSpec {
  platform: PlatformKey;
  framework?: FrameworkKey;
  label: string;
  icon?: IconData;
  docs: Docs;
  install?: InstallMatrix;
  snippet?: SnippetRef;
  customComponent?: React.ComponentType;
}

export type IntegrationRegistry = IntegrationSpec[];

// Helpers to build snippet refs
const tsRef = (file: string): SnippetRef => ({
  file,
  language: "typescript",
  filename: "app.ts",
});
const goRef = (file: string): SnippetRef => ({
  file,
  language: "go",
  filename: "main.go",
});
const pyRef = (file: string): SnippetRef => ({
  file,
  language: "python",
  filename: "app.py",
});
const yamlRef = (file: string): SnippetRef => ({
  file,
  language: "yaml",
  filename: "application.yaml",
});
const bashRef = (file: string): SnippetRef => ({
  file,
  language: "bash",
  filename: "run.sh",
});

export const registry: IntegrationRegistry = [
  // TypeScript
  {
    platform: "typescript",
    framework: "vercel_ai",
    label: "Vercel AI SDK",
    docs: {
      internal: "/integration/typescript/integrations/vercel-ai-sdk",
      external: "https://sdk.vercel.ai/docs",
    },
    icon: themedIcon(
      "/images/external-icons/vercel-lighttheme.svg",
      "/images/external-icons/vercel-darktheme.svg",
      "Vercel AI SDK",
    ),
    install: {
      js: {
        npm: "npm i langwatch ai @ai-sdk/openai",
        pnpm: "pnpm add langwatch ai @ai-sdk/openai",
        yarn: "yarn add langwatch ai @ai-sdk/openai",
        bun: "bun add langwatch ai @ai-sdk/openai",
      },
    },
    snippet: tsRef(vercelAiTsSource as unknown as string),
  },
  {
    platform: "typescript",
    framework: "mastra",
    label: "Mastra",
    docs: {
      internal: "/integration/typescript/integrations/mastra",
      external: "https://docs.mastra.ai/",
    },
    icon: themedIcon(
      "/images/external-icons/mastra-lighttheme.svg",
      "/images/external-icons/mastra-darktheme.svg",
      "Mastra",
    ),
    install: {
      js: {
        npm: "npm i @mastra/core @mastra/evals @mastra/libsql @mastra/loggers @mastra/memory @mastra/otel-exporter",
        pnpm: "pnpm add @mastra/core @mastra/evals @mastra/libsql @mastra/loggers @mastra/memory @mastra/otel-exporter",
        yarn: "yarn add @mastra/core @mastra/evals @mastra/libsql @mastra/loggers @mastra/memory @mastra/otel-exporter",
        bun: "bun add @mastra/core @mastra/evals @mastra/libsql @mastra/loggers @mastra/memory @mastra/otel-exporter",
      },
    },
    snippet: tsRef(mastraTsSource as unknown as string),
  },
  {
    platform: "typescript",
    framework: "langchain",
    label: "LangChain",
    docs: {
      internal: "/integration/typescript/integrations/langchain",
      external: "https://langchain-ai.github.io/langchain/",
    },
    icon: themedIcon(
      "/images/external-icons/langchain-lighttheme.svg",
      "/images/external-icons/langchain-darktheme.svg",
      "LangChain",
    ),
    install: {
      js: {
        npm: "npm i langwatch @langchain/openai @langchain/core",
        pnpm: "pnpm add langwatch @langchain/openai @langchain/core",
        yarn: "yarn add langwatch @langchain/openai @langchain/core",
        bun: "bun add langwatch @langchain/openai @langchain/core",
      },
    },
    snippet: tsRef(langchainTsSource as unknown as string),
  },
  {
    platform: "typescript",
    framework: "langgraph",
    label: "LangGraph",
    docs: {
      internal: "/integration/typescript/integrations/langgraph",
      external: "https://langchain-ai.github.io/langgraph/",
    },
    icon: themedIcon(
      "/images/external-icons/langgraph-lighttheme.svg",
      "/images/external-icons/langgraph-darktheme.svg",
      "LangGraph",
    ),
    install: {
      js: {
        npm: "npm i langwatch @langchain/openai @langchain/core @langchain/langgraph zod",
        pnpm: "pnpm add langwatch @langchain/openai @langchain/core @langchain/langgraph zod",
        yarn: "yarn add langwatch @langchain/openai @langchain/core @langchain/langgraph zod",
        bun: "bun add langwatch @langchain/openai @langchain/core @langchain/langgraph zod",
      },
    },
    snippet: tsRef(langgraphTsSource as unknown as string),
  },
  {
    platform: "typescript",
    framework: "openai",
    label: "OpenAI (Manual Instrumentation)",
    docs: { internal: "/integration/typescript/integrations/open-ai" },
    icon: themedIcon(
      "/images/external-icons/openai-lighttheme.svg",
      "/images/external-icons/openai-darktheme.svg",
      "LangGraph",
    ),
    install: {
      js: {
        npm: "npm i langwatch openai",
        pnpm: "pnpm add langwatch openai",
        yarn: "yarn add langwatch openai",
        bun: "bun add langwatch openai",
      },
    },
    snippet: tsRef(openaiTsSource as unknown as string),
  },

  // Python
  {
    platform: "python",
    framework: "openai",
    label: "OpenAI",
    docs: {
      internal: "/integration/python/integrations/open-ai",
      external: "https://platform.openai.com/docs/overview",
    },
    icon: themedIcon(
      "/images/external-icons/openai-lighttheme.svg",
      "/images/external-icons/openai-darktheme.svg",
      "OpenAI",
    ),
    install: {
      python: {
        pip: "pip install langwatch openai",
        uv: "uv add langwatch openai",
      },
    },
    snippet: pyRef(openaiPySource as unknown as string),
  },
  {
    platform: "python",
    framework: "openai_agents",
    label: "OpenAI Agents",
    docs: {
      internal: "/integration/python/integrations/openai-agents",
      external: "https://platform.openai.com/docs/guides/agents",
    },
    icon: iconWithLabel(
      themedIcon(
        "/images/external-icons/openai-lighttheme.svg",
        "/images/external-icons/openai-darktheme.svg",
        "OpenAI Agents",
      ),
      "Agents",
    ),
    install: {
      python: {
        pip: "pip install langwatch openai-agents openinference-instrumentation-openai-agents",
        uv: "uv add langwatch openai-agents openinference-instrumentation-openai-agents",
      },
    },
    snippet: pyRef(openaiAgentsPySource as unknown as string),
  },
  {
    platform: "python",
    framework: "langchain",
    label: "LangChain",
    docs: {
      internal: "/integration/python/integrations/langchain",
      external: "https://docs.langchain.com/oss/python/langchain/quickstart/",
    },
    icon: themedIcon(
      "/images/external-icons/langchain-lighttheme.svg",
      "/images/external-icons/langchain-darktheme.svg",
      "LangChain",
    ),
    install: {
      python: {
        pip: "pip install langwatch langchain langchain-openai",
        uv: "uv add langwatch langchain langchain-openai",
      },
    },
    snippet: pyRef(langchainPySource as unknown as string),
  },
  {
    platform: "python",
    framework: "langgraph",
    label: "LangGraph",
    docs: {
      internal: "/integration/python/integrations/langgraph",
      external: "https://docs.langchain.com/oss/python/langgraph/quickstart",
    },
    icon: themedIcon(
      "/images/external-icons/langgraph-lighttheme.svg",
      "/images/external-icons/langgraph-darktheme.svg",
      "LangGraph",
    ),
    install: {
      python: {
        pip: "pip install langwatch langgraph langchain-openai",
        uv: "uv add langwatch langgraph langchain-openai",
      },
    },
    snippet: pyRef(langgraphPySource as unknown as string),
  },
  {
    platform: "python",
    framework: "litellm",
    label: "LiteLLM",
    docs: {
      internal: "/integration/python/integrations/lite-llm",
      external: "https://docs.litellm.ai/docs/",
    },
    icon: singleIcon("/images/external-icons/litellm.avif", "LiteLLM"),
    install: {
      python: {
        pip: "pip install langwatch litellm",
        uv: "uv add langwatch litellm",
      },
    },
    snippet: pyRef(litellmPySource as unknown as string),
  },
  {
    platform: "python",
    framework: "dspy",
    label: "DSPy",
    docs: {
      internal: "/integration/python/integrations/dspy",
      external: "https://dspy.ai/",
    },
    icon: singleIcon("/images/external-icons/dspy.webp", "DSPy"),
    install: {
      python: {
        pip: "pip install langwatch dspy",
        uv: "uv add langwatch dspy",
      },
    },
    snippet: pyRef(dspyPySource as unknown as string),
  },
  {
    platform: "python",
    framework: "strands",
    label: "Strand Agents",
    docs: {
      internal: "/integration/python/integrations/strand-agents",
      external: "https://strandsagents.com/latest/",
    },
    icon: singleIcon("/images/external-icons/strands.svg", "Strands Agents"),
    install: {
      python: {
        pip: "pip install langwatch strands-agents strands-agents-tools",
        uv: "uv add langwatch strands-agents strands-agents-tools",
      },
    },
    snippet: pyRef(strandsPySource as unknown as string),
  },
  {
    platform: "python",
    framework: "agno",
    label: "Agno",
    docs: {
      internal: "/integration/python/integrations/agno",
      external: "https://docs.agno.com/introduction",
    },
    icon: singleIcon("/images/external-icons/agno.png", "Agno"),
    install: {
      python: {
        pip: "pip install langwatch agno openai openinference-instrumentation-agno",
        uv: "uv add langwatch agno openai openinference-instrumentation-agno",
      },
    },
    snippet: pyRef(agnoPySource as unknown as string),
  },
  {
    platform: "python",
    framework: "anthropic",
    label: "Anthropic",
    docs: {
      internal: "/integration/python/integrations/anthropic",
      external: "https://docs.claude.com/en/home",
    },
    icon: themedIcon(
      "/images/external-icons/anthropic-lighttheme.svg",
      "/images/external-icons/anthropic-darktheme.svg",
      "Anthropic",
    ),
    install: {
      python: {
        pip: "pip install langwatch anthropic openinference-instrumentation-anthropic",
        uv: "uv add langwatch anthropic openinference-instrumentation-anthropic",
      },
    },
    snippet: pyRef(anthropicPySource as unknown as string),
  },
  {
    platform: "python",
    framework: "pydantic",
    label: "Pydantic AI",
    docs: {
      internal: "/integration/python/integrations/pydantic-ai",
      external: "https://ai.pydantic.dev/",
    },
    icon: singleIcon("/images/external-icons/pydanticai.svg", "Pydantic AI"),
    install: {
      python: {
        pip: "pip install langwatch pydantic-ai",
        uv: "uv add langwatch pydantic-ai",
      },
    },
    snippet: pyRef(pydanticPySource as unknown as string),
  },
  {
    platform: "python",
    framework: "haystack",
    label: "Haystack",
    docs: {
      internal: "/integration/python/integrations/haystack",
      external: "https://docs.haystack.deepset.ai/docs/intro",
    },
    icon: singleIcon("/images/external-icons/haystack.png", "Haystack"),
    install: {
      python: {
        pip: "pip install langwatch openinference-instrumentation-haystack haystack-ai",
        uv: "uv add langwatch openinference-instrumentation-haystack haystack-ai",
      },
    },
    snippet: pyRef(haystackPySource as unknown as string),
  },

  // Go
  {
    platform: "go",
    framework: "openai",
    label: "OpenAI",
    docs: {
      internal: "/integration/go/integrations/open-ai",
      external: "https://github.com/openai/openai-go",
    },
    icon: themedIcon(
      "/images/external-icons/openai-lighttheme.svg",
      "/images/external-icons/openai-darktheme.svg",
      "OpenAI",
    ),
    install: {
      go: {
        "go get":
          "go get github.com/langwatch/langwatch/sdk-go github.com/openai/openai-go",
      },
    },
    snippet: goRef(goOpenaiSource as unknown as string),
  },
  {
    platform: "go",
    framework: "azure",
    label: "Azure OpenAI",
    docs: {
      internal: "/integration/go/integrations/azure-openai",
      external: "https://learn.microsoft.com/azure/ai-services/openai/",
    },
    icon: singleIcon("/images/external-icons/azure.svg", "Azure OpenAI"),
    install: {
      go: {
        "go get":
          "go get github.com/langwatch/langwatch/sdk-go github.com/openai/openai-go",
      },
    },
    snippet: goRef(goAzureSource as unknown as string),
  },
  {
    platform: "go",
    framework: "anthropic",
    label: "Anthropic",
    docs: {
      internal: "/integration/go/integrations/anthropic",
      external: "https://docs.claude.com/",
    },
    icon: themedIcon(
      "/images/external-icons/anthropic-lighttheme.svg",
      "/images/external-icons/anthropic-darktheme.svg",
      "Anthropic",
    ),
    install: {
      go: {
        "go get":
          "go get github.com/langwatch/langwatch/sdk-go github.com/openai/openai-go",
      },
    },
    snippet: goRef(goAnthropicSource as unknown as string),
  },
  {
    platform: "go",
    framework: "gemini",
    label: "Gemini",
    docs: {
      internal: "/integration/go/integrations/google-gemini",
      external: "https://ai.google.dev/",
    },
    icon: singleIcon("/images/external-icons/google.svg", "Gemini"),
    install: {
      go: {
        "go get":
          "go get github.com/langwatch/langwatch/sdk-go github.com/openai/openai-go",
      },
    },
    snippet: goRef(goGeminiSource as unknown as string),
  },
  {
    platform: "go",
    framework: "groq",
    label: "Groq",
    docs: {
      internal: "/integration/go/integrations/groq",
      external: "https://console.groq.com/docs",
    },
    icon: singleIcon("/images/external-icons/groq.svg", "Groq"),
    install: {
      go: {
        "go get":
          "go get github.com/langwatch/langwatch/sdk-go github.com/openai/openai-go",
      },
    },
    snippet: goRef(goGroqSource as unknown as string),
  },
  {
    platform: "go",
    framework: "grok",
    label: "Grok (xAI)",
    docs: {
      internal: "/integration/go/integrations/grok",
      external: "https://x.ai/",
    },
    icon: themedIcon(
      "/images/external-icons/grok-lighttheme.svg",
      "/images/external-icons/grok-darktheme.svg",
      "Grok",
    ),
    install: {
      go: {
        "go get":
          "go get github.com/langwatch/langwatch/sdk-go github.com/openai/openai-go",
      },
    },
    snippet: goRef(goGrokSource as unknown as string),
  },
  {
    platform: "go",
    framework: "mistral",
    label: "Mistral",
    docs: { external: "https://docs.mistral.ai/" },
    icon: singleIcon("/images/external-icons/mistral.svg", "Mistral"),
    install: {
      go: {
        "go get":
          "go get github.com/langwatch/langwatch/sdk-go github.com/openai/openai-go",
      },
    },
    snippet: goRef(goMistralSource as unknown as string),
  },
  {
    platform: "go",
    framework: "ollama",
    label: "Ollama",
    docs: {
      internal: "/integration/go/integrations/ollama",
      external: "https://github.com/ollama/ollama",
    },
    icon: themedIcon(
      "/images/external-icons/ollama-lighttheme.svg",
      "/images/external-icons/ollama-darktheme.svg",
      "Ollama",
    ),
    install: {
      go: {
        "go get":
          "go get github.com/langwatch/langwatch/sdk-go github.com/openai/openai-go",
      },
    },
    snippet: goRef(goOllamaSource as unknown as string),
  },

  // Java
  {
    platform: "java",
    framework: "spring",
    label: "Spring Boot AI",
    docs: {
      internal: "/integration/java/integrations/spring-ai",
      external: "https://spring.io/projects/spring-ai",
    },
    icon: singleIcon(
      "/images/external-icons/spring-boot.svg",
      "Spring Boot AI",
    ),
    snippet: yamlRef(springAiYamlSource as unknown as string),
  },

  // OpenTelemetry
  {
    platform: "opentelemetry",
    docs: {
      internal: "/integration/opentelemetry/guide",
      external: "https://opentelemetry.io/docs/getting-started/dev/",
    },
    icon: singleIcon(
      "/images/external-icons/opentelemetry.svg",
      "OpenTelemetry",
    ),
    label: "OpenTelemetry",
    customComponent: OpenTelemetrySetup,
  },

  // No/Lo
  {
    platform: "no_and_lo",
    framework: "n8n",
    label: "n8n",
    docs: { internal: "/integration/n8n", external: "https://docs.n8n.io/" },
    icon: singleIcon("/images/external-icons/n8n.svg", "n8n"),
    install: {
      js: {
        npm: "npm i @langwatch/n8n-observability @langwatch/n8n-nodes-langwatch",
        pnpm: "pnpm add @langwatch/n8n-observability @langwatch/n8n-nodes-langwatch",
        yarn: "yarn add @langwatch/n8n-observability @langwatch/n8n-nodes-langwatch",
        bun: "bun add @langwatch/n8n-observability @langwatch/n8n-nodes-langwatch",
      },
    },
    snippet: bashRef(n8nBashSource as unknown as string),
  },
  {
    platform: "no_and_lo",
    framework: "flowise",
    label: "Flowise",
    docs: {
      internal: "/integration/flowise",
      external: "https://docs.flowiseai.com/",
    },
    icon: singleIcon("/images/external-icons/flowise.svg", "Flowise"),
    customComponent: FlowiseSetup,
  },
  {
    platform: "no_and_lo",
    framework: "langflow",
    label: "Langflow",
    docs: {
      internal: "/integration/langflow",
      external: "https://docs.langflow.org/",
    },
    icon: singleIcon("/images/external-icons/langflow.svg", "Langflow"),
    customComponent: LangflowSetup,
  },
];

export function getRegistryEntry(
  platform: PlatformKey,
  framework?: FrameworkKey,
): IntegrationSpec | undefined {
  // If no framework is provided, return the first entry for the platform (platform-only items)
  if (!framework) {
    return registry.find((r) => r.platform === platform);
  }
  return registry.find(
    (r) => r.platform === platform && r.framework === framework,
  );
}

export function deriveFrameworksByPlatform(): Record<
  PlatformKey,
  { key: FrameworkKey; label: string; icon?: IconData }[]
> {
  const out: Record<
    PlatformKey,
    { key: FrameworkKey; label: string; icon?: IconData }[]
  > = {
    typescript: [],
    python: [],
    go: [],
    java: [],
    opentelemetry: [],
    no_and_lo: [],
  };
  for (const r of registry) {
    // Skip entries without a framework (platform-only items)
    if (r.framework) {
      out[r.platform].push({ key: r.framework, label: r.label, icon: r.icon });
    }
  }
  return out;
}
