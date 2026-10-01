import { IconGlyph } from "@langwatch/design-system/icons";
import type { modelProviders } from "@langwatch/model-provider-contract";
// biome-ignore lint/style/useImportType: React is needed at runtime for JSX outside jsdom tests
import React from "react";

import { Anthropic } from "../icons/anthropic.tsx";
import { AWS } from "../icons/aws.tsx";
import { Azure } from "../icons/azure.tsx";
import { Cerebras } from "../icons/cerebras.tsx";
import { Codex } from "../icons/codex.tsx";
import { Custom } from "../icons/custom.tsx";
import { DeepSeek } from "../icons/deep-seek.tsx";
import { ElevenLabs } from "../icons/eleven-labs.tsx";
import { Gemini } from "../icons/gemini.tsx";
import { GoogleCloud } from "../icons/google-cloud.tsx";
import { Groq } from "../icons/groq.tsx";
import { OpenAI } from "../icons/open-ai.tsx";
import { Twilio } from "../icons/twilio.tsx";
import { Voyage } from "../icons/voyage.tsx";
import { Xai } from "../icons/xai.tsx";

export const modelProviderIcons: Record<keyof typeof modelProviders, React.ReactNode> = {
  openai: <OpenAI />,
  openai_codex: <Codex />,
  azure: <Azure />,
  anthropic: <Anthropic />,
  elevenlabs: <ElevenLabs />,
  twilio: <Twilio />,
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
 * Provider icons that are flat monochrome marks — hardcoded near-black (or
 * no `fill`, defaulting to SVG black), near-invisible on the dark theme.
 * Coloured-brand icons are left alone; they already read well in both modes.
 */
export const MONOCHROME_PROVIDER_ICONS = new Set<keyof typeof modelProviders>([
  "openai",
  "anthropic",
  "voyage",
  "custom",
  "twilio",
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

type ProviderKey = keyof typeof modelProviderIcons;

const startsWithAny =
  (...prefixes: string[]) =>
  (model: string) =>
    prefixes.some((prefix) => model.startsWith(prefix));

// Read in order: the first matcher that recognises the id names the provider.
const PROVIDER_MATCHERS: readonly {
  provider: ProviderKey;
  matches: (model: string) => boolean;
}[] = [
  {
    provider: "openai",
    matches: startsWithAny(
      "gpt-",
      "o1",
      "o3",
      "o4",
      "text-embedding-",
      "dall-e",
      "whisper",
      "chatgpt-",
    ),
  },
  { provider: "anthropic", matches: startsWithAny("claude-", "claude/") },
  { provider: "gemini", matches: startsWithAny("gemini-", "gemma-", "text-bison") },
  { provider: "deepseek", matches: startsWithAny("deepseek-") },
  { provider: "xai", matches: startsWithAny("grok-", "xai") },
  { provider: "groq", matches: startsWithAny("groq") },
  {
    provider: "bedrock",
    matches: (model) => model.includes("bedrock") || model.startsWith("anthropic.claude"),
  },
  { provider: "cerebras", matches: startsWithAny("cerebras") },
];

/**
 * Trusts the prefix (`openai/gpt-5`) when it names a known provider, otherwise sniffs the bare
 * model id — the far more common case. Null is a real answer: the caller renders the plain label
 * rather than guessing a vendor. `@langwatch/trace-browser` holds a fourth, unpublished copy.
 */
export function inferProvider(model: string): ProviderKey | null {
  if (!model) return null;
  const slash = model.indexOf("/");
  if (slash > 0) {
    const candidate = model.slice(0, slash).toLowerCase();
    if (candidate in modelProviderIcons) return candidate as ProviderKey;
  }
  const lower = (slash > 0 ? model.slice(slash + 1) : model).toLowerCase();

  return PROVIDER_MATCHERS.find((matcher) => matcher.matches(lower))?.provider ?? null;
}

/**
 * The tiny provider mark rendered before a model name in a dense row.
 * Smaller than the model selector's icon (a touch-friendly dropdown row):
 * a preview row is dense, so the mark complements the label, not dominates it.
 */
export function ProviderIcon({ model, size }: { model: string; size: "compact" | "comfortable" }) {
  const provider = inferProvider(model);
  if (!provider) return null;
  return <ProviderIconGlyph provider={provider} size={size === "comfortable" ? "14px" : "12px"} />;
}
