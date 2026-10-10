import {
  credentialPrincipalOfToken,
  organizationCredentialOfRequest,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import type { CodingAgentApi, CodingAgentServerConfig } from "@langwatch/coding-agent-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { CodingAgentModule } from "./app/coding-agent.app.ts";
import { codingAgentEventing } from "./eventing/coding-agent-processing.pipeline.ts";
import { codingAgentRepositories } from "./repositories/coding-agent-repositories.registry.ts";
import { codingAgentV1Rest } from "./transport/coding-agent-v1.rest.ts";
import { codingAgentRest, codingAgentRollupRest } from "./transport/coding-agent.rest.ts";
import { codingAgentTrpcTransport } from "./transport/coding-agent.trpc.ts";

export const codingAgentProcessModule: PublishedProcessModule<
  "coding-agent",
  CodingAgentApi,
  CodingAgentServerConfig
> = defineProcessModule("coding-agent")
  .withRepositories(codingAgentRepositories)
  .withApi(CodingAgentModule)
  .withTransports(
    codingAgentRest,
    codingAgentRollupRest,
    codingAgentV1Rest,
    codingAgentTrpcTransport,
  )
  .withEventing(codingAgentEventing)
  .provideMiddlewareContext({
    codingAgentRestCaller: (request) => {
      const resolved = projectCredentialOfRequest(request);

      return {
        project: {
          isPersonal: resolved.project.isPersonal,
          ownerUserId: resolved.project.ownerUserId,
        },
        credential: credentialPrincipalOfToken(resolved),
      };
    },
    codingAgentV1RestCaller: (request) => {
      const credential = organizationCredentialOfRequest(request);

      return {
        apiKeyId: credential.apiKeyId,
        userId: credential.userId,
        // The member the credential acts as, or the credential itself where it
        // acts as nobody - one stable string per credential either way.
        actorId: credential.userId ?? `apikey:${credential.apiKeyId}`,
      };
    },
  });
