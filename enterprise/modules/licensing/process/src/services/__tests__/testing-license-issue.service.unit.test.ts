/**
 * Issuing a testing licence on Cloud (ADR-180 sections 2 and 3): signed with the fixed terms,
 * bound to one instance and one local organization, naming its issuer, at most 30 days.
 * Spec: specs/self-hosting/connected-services/testing-licenses.feature
 */
import {
  LicenseGenerationService,
  NodeLicenseCryptographyService,
} from "@langwatch/enterprise-license-signing";
import type { IssuedLicenseCustomerRecord } from "@langwatch/enterprise-licensing-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  TEST_PRIVATE_KEY,
  TEST_PUBLIC_KEY,
} from "../../__tests__/fixtures/license-keys.fixture.ts";
import { MemoryIssuedLicenseRepository } from "../../repositories/memory/memory.issued-license.repository.ts";
import { MemoryTestingLicenseTokenRepository } from "../../repositories/memory/memory.testing-license-token.repository.ts";
import { LicenseRegistryService } from "../license-registry.service.ts";
import { TestingLicenseIssueService } from "../testing-license-issue.service.ts";
import { TestingLicenseTokenService } from "../testing-license-token.service.ts";
import { codeOf, QuietBudgets, QuietManagedKeys } from "./support/registry-doubles.ts";

const NOW: Instant = Temporal.Instant.from("2026-01-01T00:00:00.000Z");

class NoCustomers {
  readonly marked: string[] = [];

  async findById(): Promise<IssuedLicenseCustomerRecord | null> {
    return null;
  }

  async recordSelfHostedCustomerLicensed({ id }: { id: string; name: string }): Promise<void> {
    this.marked.push(id);
  }
}

function harness({ signingKey = TEST_PRIVATE_KEY }: { signingKey?: string } = {}) {
  const licenses = MemoryIssuedLicenseRepository.create();
  const organizations = new NoCustomers();
  const cryptography = NodeLicenseCryptographyService.create({ publicKey: TEST_PUBLIC_KEY });
  const registry = LicenseRegistryService.create({
    repository: licenses,
    organizations,
    managedKeys: new QuietManagedKeys(),
    contractBudgets: new QuietBudgets(),
    cryptography,
    generation: LicenseGenerationService.create(cryptography),
    signingKey: () => signingKey,
    now: () => NOW,
  });
  const tokens = TestingLicenseTokenService.create({
    repository: MemoryTestingLicenseTokenRepository.create({ now: () => NOW }),
    now: () => NOW,
  });
  const issuing = TestingLicenseIssueService.create({ registry, tokens, now: () => NOW });
  return { registry, licenses, organizations, cryptography, tokens, issuing };
}

const ask = { instanceId: "instance-a", organizationId: "org-local" };

describe("issuing a testing licence", () => {
  describe("given a personal token's person, asking with no lifetime", () => {
    /** @scenario "Cloud staff get a testing license with no browser step" */
    it("signs a 5-day testing licence for that instance and organization, naming the person", async () => {
      const { issuing, registry, cryptography, organizations } = harness();

      const issued = await issuing.issue({
        ...ask,
        issuer: { kind: "personal", tokenId: "token-1", userId: "dev-1" },
      });

      expect(issued.expiresAt).toBe("2026-01-06T00:00:00Z");
      expect(cryptography.parseLicenseKey(issued.licenseKey)?.data).toMatchObject({
        kind: "testing",
        instanceId: "instance-a",
        organizationId: "org-local",
        plan: { type: "ENTERPRISE", maxMembers: 10, maxMembersLite: 10 },
      });
      await expect(registry.getById({ id: issued.issuedLicenseId })).resolves.toMatchObject({
        kind: "testing",
        instanceId: "instance-a",
        testingOrganizationId: "org-local",
        organizationId: null,
        issuedById: "dev-1",
        services: [],
        commitUsdCents: 0,
        overageEnabled: false,
      });
      expect(organizations.marked).toEqual([]);
    });
  });

  describe("given a lifetime of 12 hours, and then of 45 days", () => {
    /** @scenario "A testing license can be asked for a shorter or longer time, up to 30 days" */
    it("lasts 12 hours, and refuses 45 days with a code naming the limit, writing nothing", async () => {
      const { issuing, licenses } = harness();
      const issuer = { kind: "personal", tokenId: "token-1", userId: "dev-1" } as const;

      const short = await issuing.issue({ ...ask, lifetimeHours: 12, issuer });
      expect(short.expiresAt).toBe("2026-01-01T12:00:00Z");

      await expect(codeOf(issuing.issue({ ...ask, lifetimeHours: 45 * 24, issuer }))).resolves.toBe(
        "testing_license_lifetime_too_long",
      );
      await expect(
        licenses.listAll({ page: 0, pageSize: 10, includeTesting: true }),
      ).resolves.toMatchObject({
        total: 1,
      });
    });
  });

  describe("given a service token", () => {
    /** @scenario "CI gets a testing license through a service token" */
    it("names the person who made the token as the issuer and stamps its last use", async () => {
      const { issuing, registry, tokens } = harness();
      const minted = await tokens.createService({ name: "GitHub Actions", operatorId: "ops-1" });
      const tokenId = minted.testingLicenseToken.id;

      const issued = await issuing.issue({
        ...ask,
        issuer: { kind: "service", tokenId, userId: "ops-1" },
      });

      await expect(registry.getById({ id: issued.issuedLicenseId })).resolves.toMatchObject({
        issuedById: "ops-1",
      });
      const listed = await tokens.list({ page: 0, pageSize: 10 });
      expect(listed.tokens[0]).toMatchObject({ id: tokenId, lastUsedAt: "2026-01-01T00:00:00Z" });
    });
  });

  describe("given a deployment with no signing key", () => {
    /** @scenario "Cloud staff get a testing license with no browser step" */
    it("refuses as licence signing not configured", async () => {
      const { issuing } = harness({ signingKey: "" });

      await expect(
        codeOf(
          issuing.issue({ ...ask, issuer: { kind: "personal", tokenId: "t", userId: "dev-1" } }),
        ),
      ).resolves.toBe("license_signing_not_configured");
    });
  });
});
