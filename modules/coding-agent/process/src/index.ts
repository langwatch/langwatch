export type { CodingAgentRepositories } from "./repositories/coding-agent.repositories.ts";
export type {
  CodingAgentBillingPolicy,
  CodingAgentClock,
  CodingAgentCostEstimator,
  CodingAgentProjectActivity,
  CodingAgentPullRequestMapping,
} from "./app/coding-agent.members.ts";
export type {
  CodingAgentBackfillProjects,
  CodingAgentSessionReads,
} from "./services/coding-agent-pull-request-mapping-backfill.service.ts";
export type {
  CodingAgentCostMetrics,
  CodingAgentTraceProcessor,
} from "./app/coding-agent.members.ts";
export { createPullRequestMappingSubscriber } from "./eventing/pull-request-mapping.subscriber.ts";
/**
 * The feature's application: the one typed thing its transports are given.
 * Both doors reach the same object, so a rule written on it is the rule both
 * doors get.
 */
export type {
  CallerProjectScope,
  CodingAgentCallerScopeDependencies,
} from "./services/coding-agent-caller-scope.service.ts";
export type {
  CodingAgentCaller,
  CodingAgentCallerScope,
  CodingAgentPullRequestRef,
  CodingAgentScopeMembers,
} from "./app/coding-agent.app.ts";
export { codingAgentProcessModule } from "./coding-agent.module.ts";
export {
  codingAgentRest,
  codingAgentRestCaller,
  codingAgentRollupRest,
} from "./transport/coding-agent.rest.ts";
export { codingAgentV1Rest, codingAgentV1RestCaller } from "./transport/coding-agent-v1.rest.ts";
export { codingAgentTrpcTransport } from "./transport/coding-agent.trpc.ts";
export type {
  CodingAgentViewerVisibility,
  CodingAgentViewerVisibilityReader,
} from "./app/coding-agent.members.ts";
