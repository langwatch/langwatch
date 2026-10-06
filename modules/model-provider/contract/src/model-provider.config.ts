import {
  allowedProxyHosts,
  blockLocalHttpCalls,
  Config,
  langwatchDefaultModel,
  nlpServiceUrl,
  type ConfigOf,
} from "@langwatch/config";
import { z } from "zod";

/**
 * The address fence an outbound provider call is judged by, the terminal default
 * model and the NLP engine's address. Shared deployment-fact leaves: scenario
 * reads the same ones.
 */
export const modelProviderConfig = Config.define((c) => ({
  blockLocalHttpCalls,
  allowedProxyHosts,
  defaultModel: langwatchDefaultModel,
  nlpServiceUrl,
  /**
   * The API root a deployment points a provider's credential probe at, in place of the
   * vendor's own (haven sets them to llmsim and voicesim). Unset means the vendor.
   */
  probeBaseUrls: {
    gemini: c.env("GEMINI_BASE_URL", z.string().url().optional()),
    deepseek: c.env("DEEPSEEK_BASE_URL", z.string().url().optional()),
    xai: c.env("XAI_BASE_URL", z.string().url().optional()),
    cerebras: c.env("CEREBRAS_BASE_URL", z.string().url().optional()),
    groq: c.env("GROQ_BASE_URL", z.string().url().optional()),
    elevenlabs: c.env("ELEVENLABS_BASE_URL", z.string().url().optional()),
  },
}));

export type ModelProviderServerConfig = ConfigOf<typeof modelProviderConfig>;
