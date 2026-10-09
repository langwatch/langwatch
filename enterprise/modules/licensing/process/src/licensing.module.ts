import { bindRestCredential } from "@langwatch/api/rest";
import type { LicensingApi, LicensingServerConfig } from "@langwatch/enterprise-licensing-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { LicensingModule } from "./app/licensing.app.ts";
import { licenseSyncEventing } from "./eventing/license-sync.pipeline.ts";
import { licensingCustomerEventing } from "./eventing/licensing-customer.pipeline.ts";
import { licensingRepositories } from "./repositories/licensing-repositories.registry.ts";
import { LicenseMintService } from "./services/license-mint.service.ts";
import { OrganizationLicenseCopyService } from "./services/organization-license-copy.service.ts";
import { OrganizationLicenseWriterService } from "./services/organization-license-writer.service.ts";
import { GenerateLicenseTask } from "./tasks/generate-license.task.ts";
import { connectHostRest } from "./transport/connect-host.rest.ts";
import { connectHostedRest } from "./transport/connect-hosted.rest.ts";
import { connectTrpcTransport } from "./transport/connect.trpc.ts";
import { licenseTrpcTransport } from "./transport/licensing.trpc.ts";

export const licensingProcessModule: PublishedProcessModule<
  "licensing",
  LicensingApi,
  LicensingServerConfig
> = defineProcessModule("licensing")
  .withRepositories(licensingRepositories)
  .withApi(LicensingModule)
  .withTransports(licenseTrpcTransport, connectTrpcTransport, connectHostedRest, connectHostRest)
  // The Go data plane signs hosted calls with the gateway's own secret, so the
  // family answers behind the gateway's door rather than a rebuilt one.
  .withTransportFacts(({ dependencies }) => [
    bindRestCredential("internal_secret", () => dependencies.gateway.internalDoor()),
  ])
  .withEventing(licenseSyncEventing)
  .withEventing(licensingCustomerEventing)
  .withTasks(({ app, repositories }) => [
    GenerateLicenseTask.create({
      mint: LicenseMintService.create({
        licenses: app,
        organizations: repositories.connectOrganizations,
        storage: OrganizationLicenseWriterService.create({
          licenses: repositories.organizationLicenses,
          facts: app.customerFactsService(),
        }),
        registry: repositories.issuedLicenses,
      }),
    }),
  ])
  .withMigrations(({ repositories }) => [
    defineMigrationStep({
      id: "licensing:copy-organization-licenses",
      kind: "data",
      mode: "background",
      description:
        "Copies each organization's licence key and its dates into licensing's own licence table, overwriting a row that differs.",
      // An old image still serving writes the licence onto organization's columns alone.
      needsOldWritersGone: true,
      run: async ({ checkpoint, dryRun, signal }) => {
        const resumed = checkpoint.resumeFrom?.afterOrganizationId;
        return OrganizationLicenseCopyService.create({
          licenses: repositories.organizationLicenses,
        }).copyFromOrganizations({
          dryRun,
          signal,
          afterOrganizationId: typeof resumed === "string" ? resumed : null,
          onBatchDone: ({ report }) => checkpoint.save({ report }),
        });
      },
    }),
  ]);
