/* eslint-disable @next/next/no-img-element */
import React from "react";
import type { FrameworkKey, PlatformKey } from "../types.ts";
import { NoLoN8nSetup } from "../NoLoN8nSetup.tsx";
import { OpenTelemetrySetup } from "../OpenTelemetrySetup.tsx";
import vercelAiTsSource from "./snippets/typescript/vercelai.snippet.ts?raw";
import goOpenaiSource from "./snippets/go/openai.snippet.go";
import goAzureSource from "./snippets/go/azure.snippet.go";
import goAnthropicSource from "./snippets/go/anthropic.snippet.go";
import goGeminiSource from "./snippets/go/gemini.snippet.go";
import goGrokSource from "./snippets/go/grok.snippet.go";
import goMistralSource from "./snippets/go/mistral.snippet.go";
import goOllamaSource from "./snippets/go/ollama.snippet.go";

export interface InstallMatrix {
  js?: { npm: string; pnpm: string; yarn: string; bun: string };
  python?: { pip: string; uv: string };
  go?: { ["go get"]: string };
}

export interface SnippetRef {
  file: string;
  language: string;
  filename: string;
}

export interface IntegrationSpec {
  platform: PlatformKey;
  framework: FrameworkKey;
  label: string;
  icon?: React.ReactNode;
  docs: { internal?: string; external?: string };
  install?: InstallMatrix;
  snippet?: SnippetRef;
  customComponent?: React.ComponentType;
}

export type IntegrationRegistry = IntegrationSpec[];

// Helpers to build snippet refs
const tsRef = (file: string): SnippetRef => ({ file, language: "typescript", filename: "app.ts" });
const goRef = (file: string): SnippetRef => ({ file, language: "go", filename: "main.go" });

/**
 * Render a themed icon that swaps source based on prefers-color-scheme.
 * Single Responsibility: encapsulates the light/dark asset switching for icons.
 */
function themedIcon(lightSrc: string, darkSrc: string, alt: string): React.ReactElement {
  return (
    <picture>
      <source srcSet={darkSrc} media="(prefers-color-scheme: dark)" />
      <img
        src={lightSrc}
        alt={alt}
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
    </picture>
  );
}

/**
 * Render a single-source icon.
 * Single Responsibility: returns a normalized <img> with consistent sizing.
 */
function singleIcon(src: string, alt: string): React.ReactElement {
  return <img src={src} alt={alt} style={{ width: "100%", height: "100%", objectFit: "contain" }} />;
}

export const registry: IntegrationRegistry = [
  // TypeScript
  {
    platform: "typescript",
    framework: "vercel_ai",
    label: "Vercel AI SDK",
    docs: { internal: "/docs/integrations/typescript/vercel-ai", external: "https://sdk.vercel.ai/docs" },
    icon: themedIcon(
      "/images/external-icons/vercel-lighttheme.svg",
      "/images/external-icons/vercel-darktheme.svg",
      "Vercel AI SDK",
    ),
    install: {
      js: {
        npm: "npm i @langwatch/observability ai @ai-sdk/openai",
        pnpm: "pnpm add @langwatch/observability ai @ai-sdk/openai",
        yarn: "yarn add @langwatch/observability ai @ai-sdk/openai",
        bun: "bun add @langwatch/observability ai @ai-sdk/openai",
      },
    },
    snippet: tsRef(vercelAiTsSource as unknown as string),
  },

  // Go
  {
    platform: "go",
    framework: "openai",
    label: "OpenAI",
    docs: { internal: "/docs/integrations/go/openai", external: "https://github.com/openai/openai-go" },
    icon: themedIcon(
      "/images/external-icons/openai-lighttheme.svg",
      "/images/external-icons/openai-darktheme.svg",
      "OpenAI",
    ),
    install: { go: { "go get": "go get github.com/langwatch/langwatch/sdk-go github.com/openai/openai-go" } },
    snippet: goRef(goOpenaiSource as unknown as string),
  },
  {
    platform: "go",
    framework: "azure",
    label: "Azure OpenAI",
    docs: { internal: "/docs/integrations/go/azure", external: "https://learn.microsoft.com/azure/ai-services/openai/" },
    icon: singleIcon("/images/external-icons/azure.svg", "Azure OpenAI"),
    install: { go: { "go get": "go get github.com/langwatch/langwatch/sdk-go github.com/openai/openai-go" } },
    snippet: goRef(goAzureSource as unknown as string),
  },

  // Go - additional providers
  {
    platform: "go",
    framework: "anthropic",
    label: "Anthropic",
    docs: { internal: "/docs/integrations/go/anthropic", external: "https://docs.anthropic.com/" },
    icon: themedIcon(
      "/images/external-icons/anthropic-lighttheme.svg",
      "/images/external-icons/anthropic-darktheme.svg",
      "Anthropic",
    ),
    install: { go: { "go get": "go get github.com/langwatch/langwatch/sdk-go github.com/openai/openai-go" } },
    snippet: goRef(goAnthropicSource as unknown as string),
  },
  {
    platform: "go",
    framework: "gemini",
    label: "Gemini",
    docs: { internal: "/docs/integrations/go/gemini", external: "https://ai.google.dev/" },
    icon: singleIcon("/images/external-icons/google.svg", "Gemini"),
    install: { go: { "go get": "go get github.com/langwatch/langwatch/sdk-go github.com/openai/openai-go" } },
    snippet: goRef(goGeminiSource as unknown as string),
  },
  {
    platform: "go",
    framework: "grok",
    label: "Grok (xAI)",
    docs: { internal: "/docs/integrations/go/grok", external: "https://x.ai/" },
    icon: themedIcon(
      "/images/external-icons/grok-lighttheme.svg",
      "/images/external-icons/grok-darktheme.svg",
      "Grok",
    ),
    install: { go: { "go get": "go get github.com/langwatch/langwatch/sdk-go github.com/openai/openai-go" } },
    snippet: goRef(goGrokSource as unknown as string),
  },
  {
    platform: "go",
    framework: "mistral",
    label: "Mistral",
    docs: { internal: "/docs/integrations/go/mistral", external: "https://docs.mistral.ai/" },
    icon: singleIcon("/images/external-icons/mistral.svg", "Mistral"),
    install: { go: { "go get": "go get github.com/langwatch/langwatch/sdk-go github.com/openai/openai-go" } },
    snippet: goRef(goMistralSource as unknown as string),
  },
  {
    platform: "go",
    framework: "ollama",
    label: "Ollama",
    docs: { internal: "/docs/integrations/go/ollama", external: "https://github.com/ollama/ollama" },
    icon: themedIcon(
      "/images/external-icons/ollama-lighttheme.svg",
      "/images/external-icons/ollama-darktheme.svg",
      "Ollama",
    ),
    install: { go: { "go get": "go get github.com/langwatch/langwatch/sdk-go github.com/openai/openai-go" } },
    snippet: goRef(goOllamaSource as unknown as string),
  },

  // No/Lo
  {
    platform: "no_and_lo",
    framework: "n8n",
    label: "n8n",
    docs: { internal: "/docs/integrations/no-lo/n8n", external: "https://docs.n8n.io/" },
    icon: singleIcon("/images/external-icons/n8n.svg", "n8n"),
    install: {
      js: {
        npm: "npm i @langwatch/n8n-observability @langwatch/n8n-nodes-langwatch",
        pnpm: "pnpm add @langwatch/n8n-observability @langwatch/n8n-nodes-langwatch",
        yarn: "yarn add @langwatch/n8n-observability @langwatch/n8n-nodes-langwatch",
        bun: "bun add @langwatch/n8n-observability @langwatch/n8n-nodes-langwatch",
      },
    },
    customComponent: NoLoN8nSetup,
  },

  // Placeholders to be filled incrementally
  {
    platform: "python",
    framework: "openai",
    label: "OpenAI",
    docs: { internal: "/docs/integrations/python/openai", external: "https://platform.openai.com/docs" },
    icon: themedIcon(
      "/images/external-icons/openai-lighttheme.svg",
      "/images/external-icons/openai-darktheme.svg",
      "OpenAI",
    ),
    install: { python: { pip: "pip install langwatch", uv: "uv add langwatch" } },
  },
  {
    platform: "opentelemetry",
    framework: "opentelemetry",
    label: "OpenTelemetry",
    docs: { internal: "/docs/integrations/opentelemetry", external: "https://opentelemetry.io/docs/" },
    icon: singleIcon("/images/external-icons/otel.svg", "OpenTelemetry"),
    customComponent: OpenTelemetrySetup,
  },
];

export function getRegistryEntry(platform: PlatformKey, framework: FrameworkKey): IntegrationSpec | undefined {
  return registry.find((r) => r.platform === platform && r.framework === framework);
}

export function derivePlatformOptions(): Record<PlatformKey, { label: string } | undefined> {
  const out = {} as Record<PlatformKey, { label: string } | undefined>;
  for (const r of registry) {
    if (!out[r.platform]) out[r.platform] = { label: r.platform };
  }
  return out;
}

export function deriveFrameworksByPlatform(): Record<PlatformKey, { key: FrameworkKey; label: string; icon?: React.ReactNode }[]> {
  const out: Record<PlatformKey, { key: FrameworkKey; label: string; icon?: React.ReactNode }[]> = {
    typescript: [], python: [], go: [], opentelemetry: [], no_and_lo: [], other: [],
  };
  for (const r of registry) {
    out[r.platform].push({ key: r.framework, label: r.label, icon: r.icon });
  }
  return out;
}


