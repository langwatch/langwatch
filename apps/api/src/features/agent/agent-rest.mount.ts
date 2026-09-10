/**
 * Mounts the three agents REST declarations on this process's project door:
 * the current `/api/v1/agents` family (CRUD, test, call), the connected-agent
 * instance protocol, and the deprecated `/api/agents` alias.
 */
import type { AgentApi } from "@langwatch/agent-contract";
import {
  agentConnectHeaders,
  agentLegacyRest,
  agentRestErrorHandler,
  createAgentConnectRest,
  createAgentRest,
} from "@langwatch/agent-server";
import { bindRestMiddleware, type MountableRestApp, type RestErrorHandler } from "@langwatch/api/rest";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

export function mountAgentRest(
  runtime: ApiRestRuntime,
  options: Readonly<{ agents: () => AgentApi; errors: RestErrorHandler }>,
): readonly MountableRestApp[] {
  const onError = agentRestErrorHandler(options.errors);
  // Resolved once, here at mount time, off the already-composed app - never
  // at module load, where every deployment would read the protocol default.
  const relayMaxPayloadMb = options.agents().relayMaxPayloadMb();

  return [
    runtime.mount(createAgentRest(relayMaxPayloadMb).router(), options.agents, { onError }),
    runtime.mount(createAgentConnectRest(relayMaxPayloadMb).router(), options.agents, {
      onError,
      facts: [
        bindRestMiddleware(agentConnectHeaders, (context) => ({
          authorization: context.req.header("authorization"),
          projectId: context.req.header("x-project-id"),
          instanceToken: context.req.header("x-agent-instance-token"),
        })),
      ],
    }),
    runtime.mount(agentLegacyRest.router(), options.agents, { onError }),
  ];
}
