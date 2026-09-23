/**
 * GitHub's own maintenance sweep (ADR-144): branch-recheck and retention
 * prune, no events and no commands of its own. Ported from the deleted
 * `GithubWorkerFeatureInstaller`.
 */
import { defineEventingModule, type EventingSetup } from "@langwatch/eventing";

import type { GithubApp } from "../app/github.app.ts";
import type { GithubRepositories } from "../repositories/github.repositories.ts";
import { EventingGithubMaintenanceAdapter } from "../services/github-maintenance.service.ts";

export const githubMaintenanceEventing = defineEventingModule({
  pipeline: "github_maintenance",
  build: ({ app, processStore }: EventingSetup<GithubRepositories, GithubApp>) =>
    EventingGithubMaintenanceAdapter.create({
      github: app.branchMaintenance(),
      processStore,
    }).build(),
});
