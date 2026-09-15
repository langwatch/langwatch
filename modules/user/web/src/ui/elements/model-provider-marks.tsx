/**
 * Provider icons for model legacy tiles.
 * Minimal set from Design System; missing providers fall back to generic mark.
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
