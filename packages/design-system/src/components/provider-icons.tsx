// biome-ignore lint/style/useImportType: React is needed at runtime for JSX outside jsdom tests
import React from "react";

import { IconGlyph } from "./icons/index.ts";
import { Anthropic } from "./icons/provider/anthropic.tsx";
import { AWS } from "./icons/provider/aws.tsx";
import { Azure } from "./icons/provider/azure.tsx";
import { Cerebras } from "./icons/provider/cerebras.tsx";
import { Codex } from "./icons/provider/codex.tsx";
import { Custom } from "./icons/provider/custom.tsx";
import { DeepSeek } from "./icons/provider/deep-seek.tsx";
import { ElevenLabs } from "./icons/provider/eleven-labs.tsx";
import { Gemini } from "./icons/provider/gemini.tsx";
import { GoogleCloud } from "./icons/provider/google-cloud.tsx";
import { Groq } from "./icons/provider/groq.tsx";
import { OpenAI } from "./icons/provider/open-ai.tsx";
import { Twilio } from "./icons/provider/twilio.tsx";
import { Voyage } from "./icons/provider/voyage.tsx";
import { Xai } from "./icons/provider/xai.tsx";

export const modelProviderIcons = {
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

export type ProviderKey = keyof typeof modelProviderIcons;

export function isProviderKey(value: string): value is ProviderKey {
  return value in modelProviderIcons;
}

/**
 * Provider icons that are flat monochrome marks — hardcoded near-black (or
 * no `fill`, defaulting to SVG black), near-invisible on the dark theme.
 * Coloured-brand icons are left alone; they already read well in both modes.
 */
export const MONOCHROME_PROVIDER_ICONS = new Set<ProviderKey>([
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
  provider: ProviderKey;
  size: string | number;
}) {
  const icon = modelProviderIcons[provider];
  if (!icon) return null;
  return <IconGlyph icon={icon} monochrome={MONOCHROME_PROVIDER_ICONS.has(provider)} size={size} />;
}

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
    if (isProviderKey(candidate)) return candidate;
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
