import { Box } from "@chakra-ui/react";
// biome-ignore lint/style/useImportType: React is needed at runtime for JSX in non-jsdom test environments
import React from "react";
import { Anthropic } from "../../components/icons/Anthropic";
import { AWS } from "../../components/icons/AWS";
import { Azure } from "../../components/icons/Azure";
import { Cerebras } from "../../components/icons/Cerebras";
import { Custom } from "../../components/icons/Custom";
import { DeepSeek } from "../../components/icons/DeepSeek";
import { Gemini } from "../../components/icons/Gemini";
import { GoogleCloud } from "../../components/icons/GoogleCloud";
import { Groq } from "../../components/icons/Groq";
import { OpenAI } from "../../components/icons/OpenAI";
import { Voyage } from "../../components/icons/Voyage";
import { Xai } from "../../components/icons/Xai";
import type { modelProviders } from "./registry";

export const modelProviderIcons: Record<
  keyof typeof modelProviders,
  React.ReactNode
> = {
  openai: <OpenAI />,
  azure: <Azure />,
  anthropic: <Anthropic />,
  groq: <Groq />,
  vertex_ai: <GoogleCloud />,
  gemini: <Gemini />,
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
export const MONOCHROME_PROVIDER_ICONS = new Set<
  keyof typeof modelProviders
>(["openai", "anthropic", "voyage", "custom"]);

/**
 * Wraps a `modelProviderIcons[provider]` glyph so it stays legible in dark
 * mode. Wrapper-level (not fixed in the SVGs themselves) because those
 * components are shared across surfaces (model picker, docs site, trace
 * table) that render on different backgrounds — inverting only the
 * monochrome ones here keeps brand-coloured marks untouched.
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
  const isMonochrome = MONOCHROME_PROVIDER_ICONS.has(provider);
  return (
    <Box
      width={size}
      height={size}
      flexShrink={0}
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      css={{ "& > svg": { width: "100%", height: "100%" } }}
      // Pure invert(1) — the monochrome marks are flat black on
      // transparent; rotating hue afterwards would tint the result away
      // from neutral. brightness(0.92) tones the result to off-white so
      // it doesn't hard-burn against the dark surface.
      _dark={isMonochrome ? { filter: "invert(1) brightness(0.92)" } : undefined}
      aria-hidden="true"
    >
      {icon}
    </Box>
  );
}
