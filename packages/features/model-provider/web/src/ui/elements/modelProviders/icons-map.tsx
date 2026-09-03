// biome-ignore lint/style/useImportType: React is needed at runtime for JSX in non-jsdom test environments
import React from "react";
import type { modelProviders } from "@langwatch/model-provider-contract";
import { Anthropic } from "../icons/anthropic";
import { AWS } from "../icons/aws";
import { Azure } from "../icons/azure";
import { Cerebras } from "../icons/cerebras";
import { Codex } from "../icons/codex";
import { Custom } from "../icons/custom";
import { DeepSeek } from "../icons/deep-seek";
import { ElevenLabs } from "../icons/eleven-labs";
import { Gemini } from "../icons/gemini";
import { GoogleCloud } from "../icons/google-cloud";
import { Groq } from "../icons/groq";
import { OpenAI } from "../icons/open-ai";
import { Voyage } from "../icons/voyage";
import { Xai } from "../icons/xai";
import { IconGlyph } from "@langwatch/design-system/icons";

export const modelProviderIcons: Record<keyof typeof modelProviders, React.ReactNode> = {
  openai: <OpenAI />,
  openai_codex: <Codex />,
  azure: <Azure />,
  anthropic: <Anthropic />,
  elevenlabs: <ElevenLabs />,
  groq: <Groq />,
  vertex_ai: <GoogleCloud />,
  gemini: <Gemini />,
  // Deprecated fold-window provider (see registry.ts): stored rows still
  // render in the providers table until the migration folds them.
  google_agent_platform: <GoogleCloud />,
  bedrock: <AWS />,
  deepseek: <DeepSeek />,
  custom: <Custom />,
  xai: <Xai />,
  cerebras: <Cerebras />,
  voyage: <Voyage />,
  azure_safety: <Azure />,
};

/**
 * Provider icons that are flat monochrome marks — they ship with a
 * hardcoded near-black fill (or with no `fill` at all, so they default to
 * SVG's own black). On the dark theme that lands as near-invisible.
 * Coloured-brand icons (Groq orange, AWS yellow, GoogleCloud primaries,
 * Cerebras orange) are left alone — they're brand-coloured marks that
 * read well in both modes already.
 */
export const MONOCHROME_PROVIDER_ICONS = new Set<keyof typeof modelProviders>([
  "openai",
  "anthropic",
  "voyage",
  "custom",
]);

/**
 * Wraps a `modelProviderIcons[provider]` glyph so it stays legible in dark
 * mode.
 */
export function ProviderIconGlyph({
  provider,
  size,
}: {
  provider: keyof typeof modelProviders;
  size: string | number;
}) {
  const icon = modelProviderIcons[provider];
  if (!icon) return null;
  return (
    <IconGlyph
      icon={icon}
      monochrome={MONOCHROME_PROVIDER_ICONS.has(provider)}
      size={size}
    />
  );
}

type ProviderKey = keyof typeof modelProviderIcons;

/**
 * Which provider a recorded model string belongs to, or null when we cannot
 * tell.
 *
 * Two forms arrive: the prefixed one (`openai/gpt-5`) and the bare model id,
 * which is what the collector records far more often. The prefix is trusted
 * when it names a provider we know; otherwise the model id itself is sniffed.
 * Null is a real answer — the caller renders the plain label rather than
 * guessing a vendor at the reader.
 *
 * RECOVERED WITH THE COST DRAWER'S MATCHING-SPANS PREVIEW, which prints one of
 * these marks beside every model it lists. `@langwatch/trace-web` holds the
 * same inference for its model cell and does not publish it. That is the FOURTH
 * copy of something in this file's lineage, and the docblock at the top already
 * records why the promotion has not happened: these are the model-provider
 * feature's marks, this package is where they belong, and moving them is a
 * change to packages a drawer recovery does not own.
 */
export function inferProvider(model: string): ProviderKey | null {
  if (!model) return null;
  const slash = model.indexOf("/");
  if (slash > 0) {
    const candidate = model.slice(0, slash).toLowerCase();
    if (candidate in modelProviderIcons) return candidate as ProviderKey;
  }
  const lower = (slash > 0 ? model.slice(slash + 1) : model).toLowerCase();
  if (
    lower.startsWith("gpt-") ||
    lower.startsWith("o1") ||
    lower.startsWith("o3") ||
    lower.startsWith("o4") ||
    lower.startsWith("text-embedding-") ||
    lower.startsWith("dall-e") ||
    lower.startsWith("whisper") ||
    lower.startsWith("chatgpt-")
  ) {
    return "openai";
  }
  if (lower.startsWith("claude-") || lower.startsWith("claude/")) return "anthropic";
  if (
    lower.startsWith("gemini-") ||
    lower.startsWith("gemma-") ||
    lower.startsWith("text-bison")
  ) {
    return "gemini";
  }
  if (lower.startsWith("deepseek-")) return "deepseek";
  if (lower.startsWith("grok-") || lower.startsWith("xai")) return "xai";
  if (lower.startsWith("groq")) return "groq";
  if (lower.includes("bedrock") || lower.startsWith("anthropic.claude")) return "bedrock";
  if (lower.startsWith("cerebras")) return "cerebras";
  return null;
}

/**
 * The tiny provider mark rendered before a model name in a dense row.
 *
 * Smaller than the model selector's icon, which targets a touch-friendly
 * dropdown row: a preview row is dense, so the mark complements the mono label
 * instead of dominating it.
 */
export function ProviderIcon({
  model,
  size,
}: {
  model: string;
  size: "compact" | "comfortable";
}) {
  const provider = inferProvider(model);
  if (!provider) return null;
  return <ProviderIconGlyph provider={provider} size={size === "comfortable" ? "14px" : "12px"} />;
}
