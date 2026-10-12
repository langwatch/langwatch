import {
  allowedProxyHosts,
  blockLocalHttpCalls,
  Config,
  gatewayInternalUrl,
  gatewayLegacyUrl,
  gatewayPublicUrl,
  langwatchDefaultModel,
  nlpServiceUrl,
  type ConfigOf,
} from "@langwatch/config";
import { z } from "zod";

/** A vendor base unset or blank reads as the real vendor; a value that is set must be a URL. */
const optionalVendorBase = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional(),
);

/**
 * The address fence an outbound provider call is judged by, the terminal default
 * model, the NLP engine's address and the AI gateway's (Codex is pinged there).
 * Shared deployment-fact leaves: scenario, gateway and langy read the same ones.
 */
export const modelProviderConfig = Config.define((c) => ({
  blockLocalHttpCalls,
  allowedProxyHosts,
  defaultModel: langwatchDefaultModel,
  nlpServiceUrl,
  gatewayInternalUrl,
  gatewayPublicUrl,
  gatewayLegacyUrl,
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
  /** Where Codex device sign-in and refresh are reached; unset or blank is OpenAI. */
  codexOAuthIssuer: c.env("CODEX_OAUTH_ISSUER", optionalVendorBase),
}));

export type ModelProviderServerConfig = ConfigOf<typeof modelProviderConfig>;
