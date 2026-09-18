/**
 * What the scenario child process needs, and nothing else. The child is a fresh
 * `node` process per simulation, so everything its entry can reach is bundled
 * and parsed on every run -- reaching it through the server barrel pulled the
 * REST transport and the ClickHouse and Redis repositories along with it.
 */

export { createChildProcessLogger } from "./services/child-logger.service.ts";
export {
  decodeScenarioEgressPolicy,
  SCENARIO_EGRESS_POLICY_ENV,
} from "./rules/child-egress-policy.rules.ts";
export {
  executeScenarioChild,
  flushScenarioOtelTraces,
  formatScenarioChildError,
} from "./services/scenario-child-execution.service.ts";
export { NlpFetchAdapter } from "./services/nlp-fetch.service.ts";
export type { ScenarioHttp, ScenarioHttpResponse } from "./app/scenario.app.ts";
