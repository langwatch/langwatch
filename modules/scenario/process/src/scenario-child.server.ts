/**
 * What the scenario child process needs, and nothing else: it is a fresh `node` per simulation, so
 * everything reachable is parsed each run, and the server barrel dragged in REST and repositories.
 */

export { createChildProcessLogger } from "./app/scenario-composition.build.ts";
export {
  decodeScenarioEgressPolicy,
  SCENARIO_EGRESS_POLICY_ENV,
} from "./rules/child-egress-policy.rules.ts";
export {
  executeScenarioChild,
  flushScenarioOtelTraces,
  formatScenarioChildError,
} from "./services/scenario-child-execution.service.ts";
export { HttpNlpFetchChannel } from "./channels/http/http.nlp-fetch.channel.ts";
export type { ScenarioHttp, ScenarioHttpResponse } from "./app/scenario.app.ts";
