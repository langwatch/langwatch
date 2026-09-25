import {
  allowedProxyHosts,
  blockLocalHttpCalls,
  Config,
  langwatchDefaultModel,
  type ConfigOf,
} from "@langwatch/config";
import { z } from "zod";

const trimmedOptional = z
  .string()
  .optional()
  .transform((value) => value?.trim() || void 0);
const passthrough = z.string().optional();
const optionalNumber = z
  .string()
  .optional()
  .transform((value) => (value === void 0 ? void 0 : Number(value)));

/**
 * What a scenario child is started with. The ten passthrough values are main's
 * allowlist of the parent environment; the child never inherits anything else.
 */
export const scenarioConfig = Config.define((c) => ({
  /** Where a prepared child reports its run events: the deployment's own collector. */
  langwatchEndpoint: c.env("LANGWATCH_ENDPOINT", trimmedOptional),
  /** The worker media listener's public origin, forwarded only to voice children. */
  voicePublicBaseUrl: c.env("VOICE_PUBLIC_BASE_URL", trimmedOptional),
  blockLocalHttpCalls,
  allowedProxyHosts,
  defaultModel: langwatchDefaultModel,
  /** The nlpgo deadlines an agent-test turn answers inside; unusable values clamp to defaults. */
  nlpTimeouts: {
    engineCodeBlockTimeoutSeconds: c.env("NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS", optionalNumber),
    maxTimeoutMs: c.env("NLP_FETCH_MAX_TIMEOUT_MS", optionalNumber),
  },
  childParentEnvironment: {
    path: c.env("PATH", passthrough),
    home: c.env("HOME", passthrough),
    user: c.env("USER", passthrough),
    shell: c.env("SHELL", passthrough),
    lang: c.env("LANG", passthrough),
    lcAll: c.env("LC_ALL", passthrough),
    term: c.env("TERM", passthrough),
    nodeCompileCache: c.env("NODE_COMPILE_CACHE", passthrough),
    corepackEnableDownloadPrompt: c.env("COREPACK_ENABLE_DOWNLOAD_PROMPT", passthrough),
    nodeExtraCaCerts: c.env("NODE_EXTRA_CA_CERTS", passthrough),
  },
}));

export type ScenarioServerConfig = ConfigOf<typeof scenarioConfig>;
