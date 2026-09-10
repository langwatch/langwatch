import {
  bindRestMiddleware,
  credentialPrincipalOfToken,
  organizationCredentialOfRequest,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";
import { CodingAgentApp } from "./app/coding-agent.app.ts";
import { codingAgentRepositories } from "./repositories/coding-agent-repositories.registry.ts";
import {
  codingAgentRest,
  codingAgentRestCaller,
  codingAgentRollupRest,
} from "./transport/coding-agent.rest.ts";
import { codingAgentV1Rest, codingAgentV1RestCaller } from "./transport/coding-agent-v1.rest.ts";
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
  ])
  .build();
