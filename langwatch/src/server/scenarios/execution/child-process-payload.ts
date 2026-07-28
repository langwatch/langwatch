/**
 * The child process's stdin boundary.
 *
 * Its own module so it can be tested as the function the run actually calls —
 * `scenario-child-process.ts` invokes `main()` at import, so importing that
 * file from a test starts a scenario run.
 *
 * @see specs/scenarios/red-team-scenarios.feature
 */
import { ScenarioConfigSchema, type ChildProcessJobData } from "./types";

/**
 * Parses the scenario configuration, and only the scenario configuration.
 *
 * That field is the one carrying user-controlled values and the bounds that
 * matter — `ScenarioConfigSchema` caps the attacker's turn budget and the
 * length of every string re-embedded into its prompt. While the payload was
 * *cast* to its type, those caps ran only in the unit tests that called the
 * schema directly: a stored budget past the maximum would have been billed in
 * full. Parsing here is what makes them real.
 *
 * The rest of the envelope is deliberately left as it arrives.
 * `ChildProcessJobDataSchema` describes it, but `LiteLLMParamsSchema` requires
 * an `api_key` that Vertex and Bedrock params legitimately do not carry — the
 * prefetcher accepts `vertex_credentials` or `aws_access_key_id` instead — so
 * validating the whole envelope here would reject runs that work today. That
 * mismatch is worth fixing in the schema; it is not worth fixing by failing
 * every Vertex run.
 */
export function parseChildProcessJobData(raw: string): ChildProcessJobData {
  const payload = JSON.parse(raw) as ChildProcessJobData;
  return {
    ...payload,
    scenario: ScenarioConfigSchema.parse(payload.scenario),
  };
}
