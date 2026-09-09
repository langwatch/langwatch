import { defineFeature } from "@langwatch/runtime-composition";
import { createRestRouter } from "@langwatch/api/rest";
import { createTrpcRouter } from "@langwatch/api/trpc";
import { CodingAgentApp } from "./app/coding-agent.app.ts";
import { createCodingAgentV1RestApp } from "./transport/api-rest/coding-agent-v1.api.ts";
import { CodingAgentTrpcApi } from "./transport/api-trpc/coding-agent.api.ts";

export type { CodingAgentInfrastructure } from "./app/coding-agent.app.ts";

export const codingAgentRestTransport = createRestRouter(createCodingAgentV1RestApp);
export const codingAgentTrpcTransport = createTrpcRouter(CodingAgentTrpcApi.create);

export const codingAgentServer = defineFeature("coding-agent")
  .withApp(CodingAgentApp)
  .withTransports(codingAgentRestTransport, codingAgentTrpcTransport)
  .build();
