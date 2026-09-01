/**
 * The agents REST family on the versioned API framework, `/api/v1/agents`.
 *
 * It holds the agents themselves (list, create, read, update, archive), the
 * one-off test run, the relay call of a connected agent, and the HTTP
 * long-poll transport of the connect protocol under `/connect`. The
 * WebSocket upgrade `GET /api/v1/agents/connect` is served by the connect
 * gateway on the same listener, not by this app.
 *
 * `/api/agents` is the deprecated alias of the endpoints that predate this
 * family; it lives in `alias.ts`.
 */

import { AgentService } from "~/server/agents/agent.service";
import { createProjectService } from "~/server/api/v1/project-service";
import { V1_API_VERSION } from "~/server/api/v1/version";
import { getLongPollTransport } from "~/server/connected-agents/long-poll.process";
import type { LongPollTransport } from "~/server/connected-agents/long-poll.transport";
import { prisma } from "~/server/db";
import { registerAgentEndpoints, registerAgentTestEndpoint } from "./agents.v1";
import { registerCallEndpoint } from "./call.v1";
import { registerConnectEndpoints } from "./connect.v1";

/** Builds the family over one long-poll transport; tests pass their own. */
export function createAgentsApp({
  transport,
}: {
  transport: () => LongPollTransport;
}) {
  const { service, guard } = createProjectService({
    name: "agents",
    basePath: "/api/v1/agents",
  });

  return service
    .provide({
      agents: () => AgentService.create(prisma),
    })
    .version(V1_API_VERSION, (v) => {
      // The static /connect paths go first: a `/:id` verb registered before
      // them would answer for the segment "connect".
      registerConnectEndpoints({ v, transport });
      registerAgentEndpoints({ v, guard, docs: "published" });
      registerAgentTestEndpoint({ v, guard });
      registerCallEndpoint({ v, guard });
    })
    .build();
}

export const app = createAgentsApp({ transport: getLongPollTransport });
