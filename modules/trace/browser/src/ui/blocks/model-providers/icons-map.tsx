import { Azure, IconGlyph } from "@langwatch/design-system/icons";
import { modelProviderIcons as designSystemIcons } from "@langwatch/design-system/provider-icons";
import type { modelProviders } from "@langwatch/model-provider-contract";
// biome-ignore lint/style/useImportType: React needed at runtime for non-jsdom JSX
import React from "react";

import { Anthropic } from "../../elements/icons/anthropic.tsx";
import { DeepSeek } from "../../elements/icons/deep-seek.tsx";

// `langwatch` is not a configurable provider: it is the prefix of LangWatch's hosted models.
type ProviderIconKey = keyof typeof modelProviders | "langwatch";

export const modelProviderIcons: Record<ProviderIconKey, React.ReactNode> = {
  openai: designSystemIcons.openai,
  openai_codex: designSystemIcons.openai_codex,
  azure: <Azure />,
  anthropic: <Anthropic />,
  elevenlabs: designSystemIcons.elevenlabs,
  twilio: designSystemIcons.custom,
  groq: designSystemIcons.groq,
  vertex_ai: designSystemIcons.vertex_ai,
  gemini: designSystemIcons.gemini,
  // Deprecated fold-window provider (see registry.ts): stored rows still
  // render in the providers table until the migration folds them.
  google_agent_platform: designSystemIcons.google_agent_platform,
  bedrock: designSystemIcons.bedrock,
  deepseek: <DeepSeek />,
  custom: designSystemIcons.custom,
  xai: designSystemIcons.xai,
  cerebras: designSystemIcons.cerebras,
  voyage: designSystemIcons.voyage,
  azure_safety: <Azure />,
  inception: designSystemIcons.inception,
  perplexity: designSystemIcons.perplexity,
  cloudflare: designSystemIcons.cloudflare,
  langwatch: designSystemIcons.langwatch,
};

/**
 * Provider icons that are flat monochrome marks — they ship with a hardcoded near-black
 * fill (or with no `fill` at all, so they default to SVG's own black). On the dark
 * theme that lands as near-invisible.
 */
export const MONOCHROME_PROVIDER_ICONS = new Set<ProviderIconKey>([
  "openai",
  "anthropic",
  "voyage",
  "inception",
]);

/**
 * Wraps a `modelProviderIcons[provider]` glyph so it stays legible in dark
 * mode.
 */
export function ProviderIconGlyph({
  provider,
  size,
}: {
  provider: ProviderIconKey;
  size: string | number;
}) {
  const icon = modelProviderIcons[provider];
  if (!icon) return null;
  return <IconGlyph icon={icon} monochrome={MONOCHROME_PROVIDER_ICONS.has(provider)} size={size} />;
}
