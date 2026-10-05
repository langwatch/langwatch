/**
 * @vitest-environment node
 * @see enterprise/modules/licensing/specs/licensing.feature
 * The instance list names each install's customer through its own collaborators, not through
 * the licence registry.
 */
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { createTestLicensingApp } from "../../__tests__/testing.ts";
import { MemorySelfHostedInstanceRepository } from "../../repositories/memory/memory.self-hosted-instance.repository.ts";
import type { LicensingModule } from "../licensing.app.ts";

const SEEN_AT = Temporal.Instant.from("2026-09-22T12:00:00Z");
const KNOWN_ORGANIZATIONS = new Map([["org_acme", "Acme"]]);

async function installAttributedTo(
  organizationId: string,
): Promise<MemorySelfHostedInstanceRepository> {
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
  return repository;
}

/** Customers as the organization feature answers them: only Acme is known. */
const organizations = createApiFixture<OrganizationApi>({
  findProvisioningSummary: async (id) => {
    const name = KNOWN_ORGANIZATIONS.get(id);
    return name === undefined ? null : { id, name, slug: id, createdAt: nowInstant() };
  },
});

async function licensingListing(organizationId: string): Promise<LicensingModule> {
  return createTestLicensingApp({
    repositories: { selfHostedInstances: await installAttributedTo(organizationId) },
    dependencies: { organizations },
    config: { isSaas: true },
    role: "worker",
  });
}

describe("the self-hosted instance list", () => {
  describe("given an install attributed to an organization, and no licence issued to it", () => {
    /** @scenario "The instance list names each install's customer without the licence registry" */
    it("lists the install with its organization's name", async () => {
      const app = await licensingListing("org_acme");

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
      const app = await licensingListing("org_gone");

      const page = await app.listSelfHostedInstances({ page: 0, pageSize: 25 });

      expect(page.instances[0]).toMatchObject({
        organizationId: "org_gone",
        organizationName: null,
      });
    });
  });
});
