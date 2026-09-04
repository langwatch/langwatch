/**
 * `/api/agents`: the deprecated alias of the agents family.
 *
 * The family moved to `/api/v1/agents` on the versioned API framework. The
 * endpoints that predate the move (list, create, read, update, archive) keep
 * answering here from the same handlers, so an integration written against
 * the old path keeps working. Every response carries the deprecation headers
 * that name the successor, and the operations stay out of the published
 * document so the reference holds one path per operation.
 *
 * The endpoints added with the move (test, call, connect) answer only under
 * `/api/v1/agents`.
 */

import { deprecatedAlias } from "~/app/api/shared/deprecation";
import { AgentService } from "~/server/agents/agent.service";
import { createProjectService } from "~/server/api/v1/project-service";
import { V1_API_VERSION } from "~/server/api/v1/version";
import { prisma } from "~/server/db";
import { registerAgentEndpoints } from "./agents.v1";

/** The path of the family this alias points at. */
export const AGENTS_ALIAS_SUCCESSOR = "/api/v1/agents";

const { service, guard } = createProjectService({
  name: "agents-alias",
  basePath: "/api/agents",
  middleware: [deprecatedAlias({ successor: AGENTS_ALIAS_SUCCESSOR })],
});

export const app = service
  .provide({
    agents: () => AgentService.create(prisma),
  })
  .version(V1_API_VERSION, (v) => {
    registerAgentEndpoints({ v, guard, docs: "hidden" });
  })
  .build();
