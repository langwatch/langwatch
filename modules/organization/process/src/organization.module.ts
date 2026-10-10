import { organizationCredentialOfRequest } from "@langwatch/api/rest";
import type { OrganizationApi, OrganizationServerConfig } from "@langwatch/organization-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { OrganizationModule } from "./app/organization.app.ts";
import { organizationChannels } from "./channels/organization-channels.registry.ts";
import { organizationAuditEventing } from "./eventing/organization-audit.pipeline.ts";
import { organizationLifecycleEventing } from "./eventing/organization-lifecycle.pipeline.ts";
import { seatLimitEventing } from "./eventing/seat-limit.pipeline.ts";
import { organizationRepositories } from "./repositories/organization-repositories.registry.ts";
import { OrganizationPresenceSettingBackfillService } from "./services/organization-presence-setting-backfill.service.ts";
import { OrganizationPresenceSettingBackfillTask } from "./tasks/organization-presence-setting-backfill.task.ts";
import { groupsRest } from "./transport/group.rest.ts";
import { groupTrpcTransport } from "./transport/group.trpc.ts";
import { inviteTrpcTransport } from "./transport/invite.trpc.ts";
import { licenseEnforcementTrpcTransport } from "./transport/license-enforcement.trpc.ts";
import { organizationManagementRest } from "./transport/organization-management.rest.ts";
import { organizationTrpcTransport } from "./transport/organization.trpc.ts";
import { organizationsProvisioningRest } from "./transport/organizations.rest.ts";
import { personalWorkspaceFeaturesTrpcTransport } from "./transport/personal-workspace-features.trpc.ts";
import { teamsRest } from "./transport/team.rest.ts";
import { teamTrpcTransport } from "./transport/team.trpc.ts";

export const organizationProcessModule: PublishedProcessModule<
  "organization",
  OrganizationApi,
  OrganizationServerConfig
> = defineProcessModule("organization")
  .withRepositories(organizationRepositories)
  .withChannels(organizationChannels)
  .withApi(OrganizationModule)
  .withTransports(
    organizationTrpcTransport,
    inviteTrpcTransport,
    teamTrpcTransport,
    groupTrpcTransport,
    licenseEnforcementTrpcTransport,
    personalWorkspaceFeaturesTrpcTransport,
    organizationManagementRest,
    organizationsProvisioningRest,
    groupsRest,
    teamsRest,
  )
  .provideMiddlewareContext({
    // Escalation is bounded by the key itself, never by its owner's wider standing.
    organizationKeyContext: (request) => ({
      apiKeyId: organizationCredentialOfRequest(request).apiKeyId,
    }),
  })
  .withEventing(seatLimitEventing)
  .withEventing(organizationLifecycleEventing)
  .withEventing(organizationAuditEventing)
  // Old images record no presence fact: run once none serves (ADR-173 §3).
  .withMigrations(({ app }) => [
    defineMigrationStep({
      id: "organization:record-presence-settings",
      kind: "data",
      mode: "background",
      needsOldWritersGone: true,
      description: "Records every existing organization's presence setting, for presence to fold.",
      run: async ({ checkpoint, dryRun, signal }) => {
        const resumed = checkpoint.resumeFrom?.afterOrganizationId;
        const report = await OrganizationPresenceSettingBackfillService.create({
          peers: {
            organizations: app,
            record: ({ organizationId }) => app.recordStoredPresenceSetting({ organizationId }),
          },
        }).backfill({
          after: typeof resumed === "string" ? resumed : undefined,
          dryRun,
          signal,
          onPage: (page) => checkpoint.save({ report: page }),
        });
        return { ...report, dryRun };
      },
    }),
  ])
  .withTasks(({ app }) => [OrganizationPresenceSettingBackfillTask.create({ organizations: app })]);
