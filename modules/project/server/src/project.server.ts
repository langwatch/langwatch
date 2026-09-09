import { defineModule } from "@langwatch/runtime-composition";
import { ProjectApp } from "./app/project.app.ts";
import { projectRepositories } from "./repositories/project-repositories.registry.ts";
import { homeTrpcTransport } from "./transport/home.trpc.ts";
import { integrationsChecksTrpcTransport } from "./transport/integrations-checks.trpc.ts";
import { projectRest } from "./transport/project.rest.ts";
import { projectTrpcTransport } from "./transport/project.trpc.ts";

export const projectServer = defineModule("project")
  .withRepositories(projectRepositories)
  .withApp(ProjectApp)
  .withTransports(
    projectRest,
    projectTrpcTransport,
    homeTrpcTransport,
    integrationsChecksTrpcTransport,
  )
  .build();
