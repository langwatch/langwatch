import { organizationCredentialOfRequest } from "@langwatch/api/rest";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { ProjectModule } from "./app/project.app.ts";
import { projectLifecycleEventing } from "./eventing/project-lifecycle.pipeline.ts";
import { projectRepositories } from "./repositories/project-repositories.registry.ts";
import { projectRest } from "./transport/project.rest.ts";
import { projectTrpcTransport } from "./transport/project.trpc.ts";

export const projectProcessModule: PublishedProcessModule<"project", ProjectApi> =
  defineProcessModule("project")
    .withRepositories(projectRepositories)
    .withApi(ProjectModule)
    .withTransports(projectRest, projectTrpcTransport)
    .provideMiddlewareContext({
      projectRestCaller: (request) => {
        const { userId, apiKeyId } = organizationCredentialOfRequest(request);
        return { userId, apiKeyId };
      },
    })
    .withEventing(projectLifecycleEventing)
    // Old images record none of these facts: run once no old image serves (ADR-173 §3).
    .withMigrations(({ app }) => [
      defineMigrationStep({
        id: "project:record-created-facts",
        kind: "data",
        mode: "background",
        needsOldWritersGone: true,
        description:
          "Records every existing project as created, and each live project's department and presence setting.",
        // ADR-174 decision 17: billing catch-up, then judge spend, then projects.
        after: ["instant-eval:copy-judge-spend"],
        run: async ({ checkpoint, dryRun, signal }) => {
          const resumed = checkpoint.resumeFrom?.afterProjectId;
          const count = (
            key: "projects" | "departmentAssignments" | "presenceSettings" | "skippedOrphans",
          ): number => {
            const counted = checkpoint.resumeFrom?.[key];
            return typeof counted === "number" ? counted : 0;
          };
          const orphans = checkpoint.resumeFrom?.orphanProjectIds;
          const report = await app.recordExistingFacts({
            dryRun,
            signal,
            afterProjectId: typeof resumed === "string" ? resumed : null,
            countedBefore: {
              projects: count("projects"),
              departmentAssignments: count("departmentAssignments"),
              presenceSettings: count("presenceSettings"),
              skippedOrphans: count("skippedOrphans"),
              orphanProjectIds: Array.isArray(orphans)
                ? orphans.filter((id): id is string => typeof id === "string")
                : [],
            },
            onPageDone: ({ afterProjectId, report: page }) =>
              checkpoint.save({ report: { afterProjectId, ...page } }),
          });
          return { ...report, dryRun };
        },
      }),
    ]);
