import { bindRestMiddleware, organizationCredentialOfRequest } from "@langwatch/api/rest";
import { defineProcessModule } from "@langwatch/process";

import { ProjectModule } from "./app/project.app.ts";
import { projectLifecycleEventing } from "./eventing/project-lifecycle.pipeline.ts";
import { projectRepositories } from "./repositories/project-repositories.registry.ts";
import { ProjectCreatedBackfillTask } from "./tasks/project-created-backfill.task.ts";
import { ProjectDepartmentAssignedBackfillTask } from "./tasks/project-department-assigned-backfill.task.ts";
import { ProjectPresenceSettingBackfillTask } from "./tasks/project-presence-setting-backfill.task.ts";
import { projectRest, projectRestCredential } from "./transport/project.rest.ts";
import { projectTrpcTransport } from "./transport/project.trpc.ts";

export const projectProcessModule = defineProcessModule("project")
  .withRepositories(projectRepositories)
  .withApi(ProjectModule)
  .withTransports(projectRest, projectTrpcTransport)
  .withTransportFacts(() => [
    bindRestMiddleware(projectRestCredential, (context) => {
      const credential = organizationCredentialOfRequest(context.req.raw);

      return { apiKeyId: credential.apiKeyId, userId: credential.userId };
    }),
  ])
  .withEventing(projectLifecycleEventing)
  .withTasks(({ app, dependencies }) => [
    ProjectCreatedBackfillTask.create({ organizations: dependencies.organizations, projects: app }),
    ProjectPresenceSettingBackfillTask.create({
      organizations: dependencies.organizations,
      projects: app,
    }),
    ProjectDepartmentAssignedBackfillTask.create({
      organizations: dependencies.organizations,
      projects: app,
    }),
  ]);
