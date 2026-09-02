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
