// biome-ignore lint/style/useImportType: React is needed at runtime for JSX in non-jsdom test environments
import React from "react";
import type { modelProviders } from "@langwatch/model-provider-contract";
import { Anthropic } from "../../elements/icons/anthropic.tsx";
import { AWS } from "../../elements/icons/aws.tsx";
import { Azure } from "../../elements/icons/azure.tsx";
import { Cerebras } from "../../elements/icons/cerebras.tsx";
import { Codex } from "../../elements/icons/codex.tsx";
import { Custom } from "../../elements/icons/custom.tsx";
import { DeepSeek } from "../../elements/icons/deep-seek.tsx";
import { ElevenLabs } from "../../elements/icons/eleven-labs.tsx";
import { Gemini } from "../../elements/icons/gemini.tsx";
import { GoogleCloud } from "../../elements/icons/google-cloud.tsx";
import { Groq } from "../../elements/icons/groq.tsx";
import { OpenAI } from "../../elements/icons/open-ai.tsx";
import { Voyage } from "../../elements/icons/voyage.tsx";
import { Xai } from "../../elements/icons/xai.tsx";
import { IconGlyph } from "../../elements/icon-glyph.tsx";

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
 * Provider icons that are flat monochrome marks — they ship with a hardcoded near-black
 * fill (or with no `fill` at all, so they default to SVG's own black). On the dark
 * theme that lands as near-invisible.
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
  return <IconGlyph icon={icon} monochrome={MONOCHROME_PROVIDER_ICONS.has(provider)} size={size} />;
}
