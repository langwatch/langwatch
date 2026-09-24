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
