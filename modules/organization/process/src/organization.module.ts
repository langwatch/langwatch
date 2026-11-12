import { organizationCredentialOfRequest } from "@langwatch/api/rest";
import type { OrganizationApi, OrganizationServerConfig } from "@langwatch/organization-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { OrganizationModule } from "./app/organization.app.ts";
import { organizationChannels } from "./channels/organization-channels.registry.ts";
import { organizationAuditEventing } from "./eventing/organization-audit.pipeline.ts";
import { organizationLifecycleEventing } from "./eventing/organization-lifecycle.pipeline.ts";
import { privateDataplaneRecorderEventing } from "./eventing/organization-private-dataplane.pipeline.ts";
import { seatHoldCheckEventing } from "./eventing/seat-hold-check.pipeline.ts";
import { seatLimitEventing } from "./eventing/seat-limit.pipeline.ts";
import { seatPeakEventing } from "./eventing/seat-peak.pipeline.ts";
import { organizationRepositories } from "./repositories/organization-repositories.registry.ts";
import { OrganizationPageBackfillService } from "./services/organization-page-backfill.service.ts";
import { groupsRest } from "./transport/group.rest.ts";
import { groupTrpcTransport } from "./transport/group.trpc.ts";
import { inviteTrpcTransport } from "./transport/invite.trpc.ts";
import { licenseEnforcementTrpcTransport } from "./transport/license-enforcement.trpc.ts";
import { organizationManagementRest } from "./transport/organization-management.rest.ts";
import { organizationTrpcTransport } from "./transport/organization.trpc.ts";
import { organizationsProvisioningRest } from "./transport/organizations.rest.ts";
import { personalWorkspaceFeaturesTrpcTransport } from "./transport/personal-workspace-features.trpc.ts";
import { seatPeakTrpcTransport } from "./transport/seat-peak.trpc.ts";
import { seatRequestTrpcTransport } from "./transport/seat-request.trpc.ts";
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
    seatRequestTrpcTransport,
    seatPeakTrpcTransport,
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
  .withEventing(seatPeakEventing)
  .withEventing(organizationLifecycleEventing)
  .withEventing(organizationAuditEventing)
  .withEventing(privateDataplaneRecorderEventing)
  .withEventing(seatHoldCheckEventing)
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
        const { changed, ...report } = await OrganizationPageBackfillService.create({
          peers: {
            page: async (input) => {
              const page = await app.recordStoredPresenceSettingPage(input);
              return { ...page, changed: input.dryRun ? 0 : page.organizations };
            },
          },
          pageSize: 2000,
        }).backfill({
          after: typeof resumed === "string" ? resumed : undefined,
          dryRun,
          signal,
          onPage: (page) => checkpoint.save({ report: page }),
        });
        return { ...report, recorded: changed, dryRun };
      },
    }),
    // Seat changes are recorded from ADR-002 on; this opens every organization's count once.
    defineMigrationStep({
      id: "organization:record-seat-peak-opening-snapshots",
      kind: "data",
      mode: "background",
      // An old pod moves seats without recording the change, so a snapshot then misses it.
      needsOldWritersGone: true,
      description:
        "Records every organization's seat holders as they stand, to open its seat peak.",
      run: async ({ checkpoint, dryRun, signal }) => {
        const resumed = checkpoint.resumeFrom?.afterOrganizationId;
        const { changed, ...report } = await OrganizationPageBackfillService.create({
          peers: {
            page: async (input) => {
              const { opened, ...page } = await app.openSeatPeakPage(input);
              return { ...page, changed: opened };
            },
          },
          pageSize: 200,
        }).backfill({
          after: typeof resumed === "string" ? resumed : undefined,
          dryRun,
          signal,
          onPage: (page) => checkpoint.save({ report: page }),
        });
        return { ...report, opened: changed, dryRun };
      },
    }),
  ]);
