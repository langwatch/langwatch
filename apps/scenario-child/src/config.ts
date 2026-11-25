import { createLogger, type Logger } from "@langwatch/observability";
import { NLP_INTERNAL_SECRET_ENV } from "@langwatch/process/nlp-internal-secret";
import {
  SCENARIO_LOG_CONTEXT_ENV,
  scenarioLogContextSchema,
  type ScenarioLogContext,
} from "@langwatch/scenario-contract";

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

/** What the child reads off the environment its parent stated, read once at the entrypoint. */
export type ScenarioChildEnvironment = Readonly<{
  langwatchEndpoint: string | undefined;
  langwatchApiKey: string | undefined;
  verbose: boolean;
  egressPolicy: string | undefined;
  rejectUnauthorized: boolean;
  /** The engine hop's shared credential, as the parent stated it for this child. */
  nlpInternalSecret: string | undefined;
}>;

export function readScenarioChildEnvironment({
  source,
  egressPolicyKey,
}: {
  source: EnvironmentSource;
  egressPolicyKey: string;
}): ScenarioChildEnvironment {
  return {
    langwatchEndpoint: source.LANGWATCH_ENDPOINT,
    langwatchApiKey: source.LANGWATCH_API_KEY,
    verbose: source.SCENARIO_VERBOSE === "true",
    egressPolicy: source[egressPolicyKey],
    rejectUnauthorized: source.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
    nlpInternalSecret: source[NLP_INTERNAL_SECRET_ENV],
  };
}

/** The environment the parent stated for this child: the one place the program reads it. */
export const scenarioChildEnvironmentSource: EnvironmentSource = process.env;

/** The phone runner's view of this child's environment, as the parent stated it for a voice run. */
export function readScenarioChildVoiceEnvironment(source: EnvironmentSource): {
  voicePublicBaseUrl: string | undefined;
  baseHost: string | undefined;
  voicePublicBaseUrlUnavailableReason: string | undefined;
} {
  return {
    voicePublicBaseUrl: source.VOICE_PUBLIC_BASE_URL,
    baseHost: source.BASE_HOST,
    voicePublicBaseUrlUnavailableReason: source.VOICE_PUBLIC_BASE_URL_UNAVAILABLE_REASON,
  };
}

/**
 * Decode the parent's logger context. Returns an empty object when unset or malformed, never
 * throwing; malformed JSON warns on stderr so it's still visible during incident response.
 */
export function decodeScenarioLogContext(raw: string | undefined): ScenarioLogContext {
  if (!raw) {
    return {};
  }
  try {
    const parsed = scenarioLogContextSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    process.stderr.write(
      `[child-logger] ${SCENARIO_LOG_CONTEXT_ENV} is not valid JSON; ignoring\n`,
    );
    return {};
  }
}

/** The child's base logger, bound to the context its parent stated, so its logs join by id. */
export function createChildProcessLogger(name: string, env: EnvironmentSource): Logger {
  const context = decodeScenarioLogContext(env[SCENARIO_LOG_CONTEXT_ENV]);
  const base = createLogger(name);
  if (Object.keys(context).length === 0) {
    return base;
  }
  return base.child(context);
}
