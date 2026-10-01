import type { GatewayApi } from "@langwatch/gateway-contract";
import type { InstantEvalApi } from "@langwatch/instant-eval-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
/**
 * @vitest-environment node
 * @see enterprise/modules/licensing/specs/licensing.feature
 * The instance list names each install's customer through its own collaborators, not through
 * the licence registry.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { TEST_LICENSING_CONFIG } from "../../__tests__/testing.ts";
import { MemoryIssuedLicenseRepository } from "../../repositories/memory/memory.issued-license.repository.ts";
import { MemorySelfHostedInstanceRepository } from "../../repositories/memory/memory.self-hosted-instance.repository.ts";
import { LicensingInfrastructureService } from "../../services/licensing-infrastructure.service.ts";
import { LicensingApp, type LicensingInfrastructure } from "../licensing.app.ts";
import type { SelfHostedInstancesInfrastructure } from "../licensing.members.ts";

const SEEN_AT = Temporal.Instant.from("2026-09-22T12:00:00Z");
const KNOWN_ORGANIZATIONS = new Map([["org_acme", "Acme"]]);

function storesWithoutMutation(): LicensingInfrastructure {
  return LicensingInfrastructureService.create({ processName: "the worker" }).withoutMutation({
    licenses: {
      getOrganizationLicense: () => Promise.resolve({ licenseKey: null }),
      findOrganizationsWithLicense: () => Promise.resolve([]),
    },
  });
}

async function instancesAttributedTo(
  organizationId: string,
): Promise<SelfHostedInstancesInfrastructure> {
  const repository = MemorySelfHostedInstanceRepository.create();
  await repository.upsert({
    instanceId: "install-1",
    lastSeenAt: SEEN_AT,
    version: "3.17.0",
    installMethod: "helm",
    chartVersion: "1.3.0",
    hostname: "langwatch.acme.test",
    environment: "production",
    installedAt: null,
    reportSchemaVersion: 2,
    organizationId,
    issuedLicenseId: null,
    userEmailDomains: { "acme.test": 12 },
    latestReport: { version: "3.17.0" },
    optionalMetricsReported: true,
    hostnameReported: true,
    lastUnknownFields: 0,
    raisedSignals: [],
  });
  return {
    repository,
    licenses: MemoryIssuedLicenseRepository.create(),
    organizations: {
      findById: (id) => {
        const name = KNOWN_ORGANIZATIONS.get(id);
        return Promise.resolve(name === undefined ? null : { id, name });
      },
    },
    optionalReportKeys: new Set(),
  };
}

function licensingOver(infrastructure: LicensingInfrastructure): Promise<LicensingApp> {
  return LicensingApp.create({
    dependencies: {
      instantEval: createApiFixture<InstantEvalApi>(),
      projects: createApiFixture<ProjectApi>(),
      gateway: createApiFixture<GatewayApi>(),
      organizations: createApiFixture<OrganizationApi>(),
    },
    members: { infrastructure, isSaas: true, serviceVersion: "test" },
    config: TEST_LICENSING_CONFIG,
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(void 0)),
  });
}

describe("the self-hosted instance list", () => {
  describe("given an install attributed to an organization, and no licence registry composed", () => {
    /** @scenario "The instance list names each install's customer without the licence registry" */
    it("lists the install with its organization's name", async () => {
      const app = await licensingOver({
        ...storesWithoutMutation(),
        instances: await instancesAttributedTo("org_acme"),
      });

      const page = await app.listSelfHostedInstances({ page: 0, pageSize: 25 });

      expect(page.total).toBe(1);
      expect(page.instances[0]).toMatchObject({
        instanceId: "install-1",
        organizationId: "org_acme",
        organizationName: "Acme",
      });
    });
  });

  describe("given an install attributed to an organization the organization feature does not know", () => {
    /** @scenario "An install whose customer the organization feature no longer knows lists without a name" */
    it("lists the install with no organization name", async () => {
      const app = await licensingOver({
        ...storesWithoutMutation(),
        instances: await instancesAttributedTo("org_gone"),
      });

      const page = await app.listSelfHostedInstances({ page: 0, pageSize: 25 });

      expect(page.instances[0]).toMatchObject({
        organizationId: "org_gone",
        organizationName: null,
      });
    });
  });

  describe("given a process composed without stores or an instance registry", () => {
    /** @scenario "A process that composes no stores refuses the instance registry by name" */
    it("refuses the read naming the self-hosted instance registry", async () => {
      const app = await licensingOver(storesWithoutMutation());

      await expect(app.listSelfHostedInstances({ page: 0, pageSize: 25 })).rejects.toThrow(
        "does not compose the self-hosted instance registry",
      );
    });
  });
});
