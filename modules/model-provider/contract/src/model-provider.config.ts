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

const blankIsUnset = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional(),
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
  /**
   * Install-wide provider settings, keyed by the provider field they stand in for: a project's
   * provider row that leaves one of these empty uses the deployment's value, as before.
   */
  providerFallbacks: {
    OPENAI_BASE_URL: c.env("OPENAI_BASE_URL", blankIsUnset),
    ANTHROPIC_BASE_URL: c.env("ANTHROPIC_BASE_URL", blankIsUnset),
    AZURE_OPENAI_ENDPOINT: c.env("AZURE_OPENAI_ENDPOINT", blankIsUnset),
    CUSTOM_BASE_URL: c.env("CUSTOM_BASE_URL", blankIsUnset),
    VERTEXAI_PROJECT: c.env("VERTEXAI_PROJECT", blankIsUnset),
    VERTEXAI_LOCATION: c.env("VERTEXAI_LOCATION", blankIsUnset),
    AWS_REGION_NAME: c.env("AWS_REGION_NAME", blankIsUnset),
  },
  /** Where Codex device sign-in and refresh are reached; unset or blank is OpenAI. */
  codexOAuthIssuer: c.env("CODEX_OAUTH_ISSUER", optionalVendorBase),
}));

export type ModelProviderServerConfig = ConfigOf<typeof modelProviderConfig>;
