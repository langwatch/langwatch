import {
  allowedProxyHosts,
  allowLoopbackVoiceProviders,
  blockLocalHttpCalls,
  Config,
  langwatchDefaultModel,
  type ConfigOf,
} from "@langwatch/config";
import { z } from "zod";

import { SCENARIO_WORKER } from "./scenario-execution.constants.ts";
import {
  isScenarioResourceClass,
  SCENARIO_RESOURCE_CLASSES,
  type ScenarioResourceClass,
} from "./scenario-resource-class.ts";

const trimmedOptional = z
  .string()
  .optional()
  .transform((value) => value?.trim() || void 0);
const passthrough = z.string().optional();
/** On unless the value is the literal "false" (case-insensitive). */
const onUnlessFalse = z
  .string()
  .optional()
  .transform((value) => (value ?? "").trim().toLowerCase() !== "false");
/** Off unless the value is the literal "true" (case-insensitive). */
const offUnlessTrue = z
  .string()
  .optional()
  .transform((value) => (value ?? "").trim().toLowerCase() === "true");
const optionalNumber = z
  .string()
  .optional()
  .transform((value) => (value === void 0 ? void 0 : Number(value)));

const allResourceClasses = Object.keys(SCENARIO_RESOURCE_CLASSES).filter(isScenarioResourceClass);
/** A comma list of runtime classes; unset means every class, an unknown name is refused. */
const resourceClassSet = z
  .string()
  .optional()
  .transform((value, ctx): ScenarioResourceClass[] => {
    const names = (value ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    if (names.length === 0) return allResourceClasses;
    const known = names.filter(isScenarioResourceClass);
    if (known.length !== names.length) {
      ctx.addIssue({ code: "custom", message: `unknown runtime class in "${value}"` });
      return z.NEVER;
    }
    return known;
  });
/** A positive whole number of slots; unset means today's concurrency. */
const slotBudget = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (value === void 0 || value.trim() === "") return SCENARIO_WORKER.CONCURRENCY;
    const slots = Number(value);
    if (Number.isInteger(slots) && slots > 0) return slots;
    ctx.addIssue({
      code: "custom",
      message: `slot budget must be a positive integer, got "${value}"`,
    });
    return z.NEVER;
  });

/**
 * What a scenario child is started with. The ten passthrough values are main's
 * allowlist of the parent environment; the child never inherits anything else.
 */
export const scenarioConfig = Config.define((c) => ({
  /** Where a prepared child reports its run events: the deployment's own collector. */
  langwatchEndpoint: c.env("LANGWATCH_ENDPOINT", trimmedOptional),
  /** The worker media listener's public origin, forwarded only to voice children. */
  voicePublicBaseUrl: c.env("VOICE_PUBLIC_BASE_URL", trimmedOptional),
  /** The worker's quick-tunnel fallback when no public origin is set. */
  voiceTunnel: c.env("VOICE_TUNNEL", onUnlessFalse),
  /** A voice-only worker refuses to boot without a public https origin. */
  voiceWorkerOnly: c.env("VOICE_WORKER_ONLY", offUnlessTrue),
  /** The runtime classes this worker admits; a refused job retries on a worker that consumes it. */
  consumedResourceClasses: c.env("SCENARIO_CONSUMED_RESOURCE_CLASSES", resourceClassSet),
  /** The slots this worker's execution pool holds; a run takes its class's weight. */
  slotBudget: c.env("SCENARIO_SLOT_BUDGET", slotBudget),
  /** The browser call's length cap in seconds; unusable values fall back to the default. */
  voiceCallMaxSeconds: c.env("VOICE_CALL_MAX_SECONDS", passthrough),
  /** Dev only: a loopback voice stand-in's signed URL passes the check. */
  allowLoopbackVoiceProviders,
  blockLocalHttpCalls,
  allowedProxyHosts,
  defaultModel: langwatchDefaultModel,
  /** The nlpgo deadlines an agent-test turn answers inside; unusable values clamp to defaults. */
  nlpTimeouts: {
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
