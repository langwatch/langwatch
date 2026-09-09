import { defineFeature } from "@langwatch/runtime-composition";
import { GithubApp } from "./app/github.app.ts";

export type { GithubInfrastructure } from "./app/github.app.ts";

export const githubServer = defineFeature("github").withApp(GithubApp).build();
