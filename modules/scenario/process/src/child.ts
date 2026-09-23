/**
 * What the scenario child process needs, and nothing else: it is a fresh `node` per simulation, so
 * everything reachable is parsed each run, and the server barrel dragged in REST and repositories.
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
