import { defineModule } from "@langwatch/runtime-composition";
import { GithubApp } from "./app/github.app.ts";
import { githubRepositories } from "./repositories/github-repositories.registry.ts";
import { githubInstallRest } from "./transport/github-install.rest.ts";
import { githubTrpcTransport } from "./transport/github.trpc.ts";

export type { GithubInfrastructure } from "./app/github.app.ts";

export const githubServer = defineModule("github")
  .withRepositories(githubRepositories)
  .withApp(GithubApp)
  .withTransports(githubInstallRest, githubTrpcTransport)
  .build();
