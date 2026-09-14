// Activity tables and their dependencies; separate entry to isolate tRPC
// React hooks import from root entry imported by trace explorer and tests.

export { codingAgentApi, type CodingAgentApiMap } from "./coding-agent-api.ts";
export {
  CodingAgentActivityHost,
  CodingAgentActivityHostProvider,
  useCodingAgentActivityHost,
  type CodingAgentFailure,
  type CodingAgentNotice,
  type CodingAgentRouteReading,
} from "./coding-agent-activity-host.ts";
export { PullRequestsTable } from "./pull-requests-table.tsx";
export { SessionsTable } from "./sessions-table.tsx";
export {
  decodePullRequestRef,
  encodePullRequestRef,
  PULL_REQUEST_QUERY_KEY,
  type PullRequestDetailRef,
} from "./pull-request-detail-address.ts";
