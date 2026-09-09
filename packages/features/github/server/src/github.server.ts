import { defineFeature } from "@langwatch/runtime-composition";
import { GithubApp } from "./app/github.app.ts";
import { githubInstallRest } from "./transport/github-install.rest.ts";
import { githubTrpcTransport } from "./transport/github.trpc.ts";

export type { GithubInfrastructure } from "./app/github.app.ts";

export const githubServer = defineFeature("github")
  .withApp(GithubApp)
  .withTransports(githubInstallRest, githubTrpcTransport)
  .build();
