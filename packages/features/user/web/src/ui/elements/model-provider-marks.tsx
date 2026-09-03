/**
 * The provider marks a legacy tile row renders.
 *
 * A tile names its icon one of two ways. `iconAsset` is the current one — a
 * `preset:<kind>` or a `data:` URL — and it is resolved without this map at
 * all. `iconKey` is the older one, a model-provider registry key, and this is
 * what answers it.
 *
 * MINIMAL ON PURPOSE, and narrower than the platform map it replaces. The
 * Design System publishes five of these marks and this imports them; the other
 * ten are `platform/app` components that the whole product still uses, so
 * promoting them means deleting the platform copies and repointing fifteen call
 * sites, which is an edit to `platform/app` this move may not make. Copying
 * three hundred lines of SVG for a third time — `@langwatch/gateway-web`
 * already carries the second copy — would be the worse answer: the marks would
 * then drift in three places. So a provider with no published mark renders the
 * generic model mark instead of its brand, on the legacy path only.
 *
 * The key set is the contract's, so a provider added to the registry fails the
 * typecheck here rather than rendering a blank tile.
 */

import {
  AnthropicIcon,
  AWSIcon,
  CustomIcon,
  LLMIcon,
  MicrosoftIcon,
  OpenAIIcon,
} from "@langwatch/design-system/icons";
import type { modelProviders } from "@langwatch/model-provider-contract";
import type { ReactNode } from "react";

export const modelProviderIcons: Record<keyof typeof modelProviders, ReactNode> = {
  openai: <OpenAIIcon />,
  openai_codex: <OpenAIIcon />,
  azure: <MicrosoftIcon />,
  anthropic: <AnthropicIcon />,
  elevenlabs: <LLMIcon />,
  groq: <LLMIcon />,
  vertex_ai: <LLMIcon />,
  gemini: <LLMIcon />,
  // Deprecated fold-window provider: stored rows still name it until the
  // migration folds them.
  google_agent_platform: <LLMIcon />,
  bedrock: <AWSIcon />,
  deepseek: <LLMIcon />,
  custom: <CustomIcon />,
  xai: <LLMIcon />,
  cerebras: <LLMIcon />,
  voyage: <LLMIcon />,
  azure_safety: <MicrosoftIcon />,
};
