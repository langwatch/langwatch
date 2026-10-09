import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { defineMigrationStep, type MigrationStepRun } from "@langwatch/upgrade/step";

import { ProjectModule } from "./app/project.app.ts";
import { projectLifecycleEventing } from "./eventing/project-lifecycle.pipeline.ts";
import { projectRepositories } from "./repositories/project-repositories.registry.ts";
import { ProjectFactsBackfillService } from "./services/project-facts-backfill.service.ts";
import { ProjectCreatedBackfillTask } from "./tasks/project-created-backfill.task.ts";
import { ProjectDepartmentAssignedBackfillTask } from "./tasks/project-department-assigned-backfill.task.ts";
import { ProjectPresenceSettingBackfillTask } from "./tasks/project-presence-setting-backfill.task.ts";
import { projectRest } from "./transport/project.rest.ts";
import { projectTrpcTransport } from "./transport/project.trpc.ts";

export const projectProcessModule: PublishedProcessModule<"project", ProjectApi> =
  defineProcessModule("project")
    .withRepositories(projectRepositories)
    .withApi(ProjectModule)
    .withTransports(projectRest, projectTrpcTransport)
    .withEventing(projectLifecycleEventing)
    // Old images record none of these facts: each runs once no old image serves (ADR-173 §3).
    .withMigrations(({ app, dependencies }) => {
      const backfill =
        (fact: {
          record: (input: { organizationId: string }) => Promise<number>;
          preview?: (input: { organizationId: string }) => Promise<number>;
        }): MigrationStepRun =>
        async ({ checkpoint, dryRun, signal }) => {
          const resumed = checkpoint.resumeFrom?.afterOrganizationId;
          const report = await ProjectFactsBackfillService.create({
            peers: { organizations: dependencies.organizations, ...fact },
          }).backfill({
            after: typeof resumed === "string" ? resumed : undefined,
            dryRun,
            signal,
            onPage: (page) => checkpoint.save({ report: page }),
          });
          return { ...report, dryRun };
        };
      return [
        defineMigrationStep({
          id: "project:record-created-facts",
          kind: "data",
          mode: "background",
          needsOldWritersGone: true,
          description:
            "Records every existing project as created, so the Instant Evals judge, nurturing and data privacy know it.",
          // ADR-174 decision 17: billing catch-up, then judge spend, then projects.
          after: ["instant-eval:copy-judge-spend"],
          run: backfill({
            record: ({ organizationId }) => app.recordExistingProjectsCreated({ organizationId }),
            preview: ({ organizationId }) =>
              app.recordExistingProjectsCreated({ organizationId, isDryRun: true }),
          }),
        }),
        defineMigrationStep({
          id: "project:record-department-assignments",
          kind: "data",
          mode: "background",
          needsOldWritersGone: true,
          description:
            "Records every existing project's department, team and personal flag, for data privacy to fold.",
          run: backfill({
            record: ({ organizationId }) =>
              app.recordExistingDepartmentAssignments({ organizationId }),
          }),
        }),
        defineMigrationStep({
          id: "project:record-presence-settings",
          kind: "data",
          mode: "background",
          needsOldWritersGone: true,
          description: "Records every existing project's presence setting, for presence to fold.",
          run: backfill({
            record: ({ organizationId }) => app.recordExistingPresenceSettings({ organizationId }),
          }),
        }),
      ];
    })
    .withTasks(({ app, dependencies }) => [
      ProjectCreatedBackfillTask.create({
        organizations: dependencies.organizations,
        projects: app,
      }),
      ProjectPresenceSettingBackfillTask.create({
        organizations: dependencies.organizations,
        projects: app,
      }),
      ProjectDepartmentAssignedBackfillTask.create({
        organizations: dependencies.organizations,
        projects: app,
      }),
    ]);
