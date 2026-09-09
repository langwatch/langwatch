import { defineFeature } from "@langwatch/runtime-composition";
import { ProjectApp } from "./app/project.app.ts";
import { homeTrpcTransport } from "./transport/home.trpc.ts";
import { integrationsChecksTrpcTransport } from "./transport/integrations-checks.trpc.ts";
import { projectRest } from "./transport/project.rest.ts";
import { projectTrpcTransport } from "./transport/project.trpc.ts";

export const projectServer = defineFeature("project")
  .withApp(ProjectApp)
  .withTransports(projectRest, projectTrpcTransport, homeTrpcTransport, integrationsChecksTrpcTransport)
  .build();
