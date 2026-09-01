/**
 * The coding-agent activity tables, and everything a screen needs to mount
 * them.
 *
 * Its own entry rather than the package root, and the reason is the transport:
 * these are the only modules here that call procedures, so they are the only
 * ones that pull in the tRPC React hooks. The root entry is imported by
 * `platform/app`'s trace explorer and by a server-side test that reads one
 * timeline helper out of it, and neither should acquire a query client to do
 * it.
 *
 * `codingAgentApi` is exported for exactly one caller: the screen family that
 * renders these tables names it so the process shell can mount its Provider.
 * `apps/ui` may not import this package directly — it is not a governed web
 * package — so the naming happens one level up, in
 * `@langwatch/user-web`'s `screens/personal-workspace`.
 */

export { codingAgentApi, type CodingAgentApiMap } from "./coding-agent-api";
export {
  CodingAgentActivityHostPort,
  CodingAgentActivityHostProvider,
  useCodingAgentActivityHost,
  type CodingAgentFailure,
  type CodingAgentNotice,
  type CodingAgentRouteReading,
} from "./coding-agent-activity-host";
export { PullRequestsTable } from "./pull-requests-table";
export { SessionsTable } from "./sessions-table";
export {
  decodePullRequestRef,
  encodePullRequestRef,
  PULL_REQUEST_QUERY_KEY,
  type PullRequestDetailRef,
} from "./pull-request-detail-address";
