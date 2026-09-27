type EnvironmentSource = Readonly<Record<string, string | undefined>>;

/** What the child reads off the environment its parent stated, read once at the entrypoint. */
export type ScenarioChildEnvironment = Readonly<{
  langwatchEndpoint: string | undefined;
  langwatchApiKey: string | undefined;
  verbose: boolean;
  egressPolicy: string | undefined;
  rejectUnauthorized: boolean;
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
