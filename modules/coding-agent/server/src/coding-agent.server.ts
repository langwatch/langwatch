import { defineServerModule } from "@langwatch/runtime-composition";
import { CodingAgentApp } from "./app/coding-agent.app.ts";
import { codingAgentRepositories } from "./repositories/coding-agent-repositories.registry.ts";
import { codingAgentRest, codingAgentRollupRest } from "./transport/coding-agent.rest.ts";
import { codingAgentV1Rest } from "./transport/coding-agent-v1.rest.ts";
import { codingAgentTrpcTransport } from "./transport/coding-agent.trpc.ts";

export type { CodingAgentInfrastructure } from "./app/coding-agent.app.ts";

export const codingAgentServer = defineServerModule("coding-agent")
  .withRepositories(codingAgentRepositories)
  .withApp(CodingAgentApp)
  .withTransports(
    codingAgentRest,
    codingAgentRollupRest,
    codingAgentV1Rest,
    codingAgentTrpcTransport,
  )
  .build();
