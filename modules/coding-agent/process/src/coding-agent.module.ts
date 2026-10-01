import {
  bindRestMiddleware,
  credentialPrincipalOfToken,
  organizationCredentialOfRequest,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineProcessModule } from "@langwatch/process";

import { CodingAgentModule } from "./app/coding-agent.app.ts";
import { codingAgentEventing } from "./eventing/coding-agent-processing.pipeline.ts";
import { codingAgentRepositories } from "./repositories/coding-agent-repositories.registry.ts";
import { codingAgentV1Rest, codingAgentV1RestCaller } from "./transport/coding-agent-v1.rest.ts";
import {
  codingAgentRest,
  codingAgentRestCaller,
  codingAgentRollupRest,
} from "./transport/coding-agent.rest.ts";
import { codingAgentTrpcTransport } from "./transport/coding-agent.trpc.ts";

export type { CodingAgentInfrastructure } from "./app/coding-agent.app.ts";

export const codingAgentProcessModule = defineProcessModule("coding-agent")
  .withRepositories(codingAgentRepositories)
  .withApi(CodingAgentModule)
  .withTransports(
    codingAgentRest,
    codingAgentRollupRest,
    codingAgentV1Rest,
    codingAgentTrpcTransport,
  )
  .withEventing(codingAgentEventing)
  .withTransportFacts(() => [
    bindRestMiddleware(codingAgentRestCaller, (context) => {
      const resolved = projectCredentialOfRequest(context.req.raw);

      return {
        project: {
          isPersonal: resolved.project.isPersonal,
          ownerUserId: resolved.project.ownerUserId,
        },
        credential: credentialPrincipalOfToken(resolved),
      };
    }),
    bindRestMiddleware(codingAgentV1RestCaller, (context) => {
      const credential = organizationCredentialOfRequest(context.req.raw);

      return {
        apiKeyId: credential.apiKeyId,
        userId: credential.userId,
        // The member the credential acts as, or the credential itself where it
        // acts as nobody - one stable string per credential either way.
        actorId: credential.userId ?? `apikey:${credential.apiKeyId}`,
      };
    }),
  ]);
