// biome-ignore lint/style/useImportType: React is needed at runtime for JSX in non-jsdom test environments
import React from "react";
import type { modelProviders } from "~/server/modelProviders/registry";
import { Anthropic } from "../icons/Anthropic";
import { AWS } from "../icons/AWS";
import { Azure } from "../icons/Azure";
import { Cerebras } from "../icons/Cerebras";
import { Codex } from "../icons/Codex";
import { Custom } from "../icons/Custom";
import { DeepSeek } from "../icons/DeepSeek";
import { ElevenLabs } from "../icons/ElevenLabs";
import { Gemini } from "../icons/Gemini";
import { GoogleCloud } from "../icons/GoogleCloud";
import { Groq } from "../icons/Groq";
import { OpenAI } from "../icons/OpenAI";
import { Voyage } from "../icons/Voyage";
import { Xai } from "../icons/Xai";
import { IconGlyph } from "../ui/IconGlyph";

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
