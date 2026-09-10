import { bindRestMiddleware, organizationCredentialOfRequest } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";
import { ProjectApp } from "./app/project.app.ts";
import { projectRepositories } from "./repositories/project-repositories.registry.ts";
import { homeTrpcTransport } from "./transport/home.trpc.ts";
import { integrationsChecksTrpcTransport } from "./transport/integrations-checks.trpc.ts";
import { projectRest, projectRestCredential } from "./transport/project.rest.ts";
import { projectTrpcTransport } from "./transport/project.trpc.ts";

export const projectServer = defineServerModule("project")
  .withRepositories(projectRepositories)
  .withApp(ProjectApp)
  .withTransports(
    projectRest,
    projectTrpcTransport,
    homeTrpcTransport,
    integrationsChecksTrpcTransport,
  )
  .withTransportFacts(() => [
    bindRestMiddleware(projectRestCredential, (context) => {
      const credential = organizationCredentialOfRequest(context.req.raw);

      return { apiKeyId: credential.apiKeyId, userId: credential.userId };
    }),
  ])
  .build();
