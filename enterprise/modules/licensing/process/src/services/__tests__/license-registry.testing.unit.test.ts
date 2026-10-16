/**
 * Testing licences in the registry (ADR-180 sections 3 and 6): bound from issue, kept a testing
 * licence through a reissue, and never counted towards seats, invoices or contract totals.
 * Spec: specs/self-hosting/connected-services/testing-licenses.feature
 */
import {
  LicenseGenerationService,
  NodeLicenseCryptographyService,
} from "@langwatch/enterprise-license-signing";
import type { IssuedLicenseCustomerRecord } from "@langwatch/enterprise-licensing-contract";
import { Temporal, toDate, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  TEST_PRIVATE_KEY,
  TEST_PUBLIC_KEY,
} from "../../__tests__/fixtures/license-keys.fixture.ts";
import { MemoryIssuedLicenseRepository } from "../../repositories/memory/memory.issued-license.repository.ts";
import { contractTermsOf } from "../../rules/contract-terms.rules.ts";
import { LicenseRegistryService } from "../license-registry.service.ts";
import { codeOf, QuietBudgets, QuietManagedKeys } from "./support/registry-doubles.ts";

const NOW: Instant = Temporal.Instant.from("2026-01-01T00:00:00.000Z");
const TERM_END: Instant = Temporal.Instant.from("2027-01-01T00:00:00.000Z");
const TESTING_END: Instant = Temporal.Instant.from("2026-01-06T00:00:00.000Z");

class RecordingCustomers {
  readonly marked: string[] = [];

  async findById(id: string): Promise<IssuedLicenseCustomerRecord | null> {
    return { id, name: "ACME" };
  }

  async recordSelfHostedCustomerLicensed({ id }: { id: string; name: string }): Promise<void> {
    this.marked.push(id);
  }
}

function harness() {
  const repository = MemoryIssuedLicenseRepository.create();
  const organizations = new RecordingCustomers();
  const cryptography = NodeLicenseCryptographyService.create({ publicKey: TEST_PUBLIC_KEY });
  const generation = LicenseGenerationService.create(cryptography);
  const registry = LicenseRegistryService.create({
    repository,
    organizations,
    managedKeys: new QuietManagedKeys(),
    contractBudgets: new QuietBudgets(),
    cryptography,
    generation,
    signingKey: () => TEST_PRIVATE_KEY,
    now: () => NOW,
  });
  const testingLicenseKey = () =>
    generation.generate({
      organizationId: "org-local",
      organizationName: "Developer stack",
      email: "developer@langwatch.test",
      planType: "ENTERPRISE",
      maxMembers: 10,
      maxMembersLite: 10,
      expiresAt: toDate(TESTING_END),
      privateKey: TEST_PRIVATE_KEY,
      now: toDate(NOW),
      testing: { instanceId: "instance-a" },
    }).licenseKey;
  return { registry, repository, organizations, cryptography, testingLicenseKey };
}

describe("given a testing licence in the registry", () => {
  /** @scenario "A testing license cannot be reset onto another instance or turned standard" */
  it("is recorded as a testing licence bound to its instance from issue", async () => {
    const { registry, testingLicenseKey } = harness();

    const license = await registry.record({
      licenseKey: testingLicenseKey(),
      source: "SCRIPT",
      organizationId: "org-cloud-customer",
    });

    expect(license).toMatchObject({
      kind: "testing",
      instanceId: "instance-a",
      testingOrganizationId: "org-local",
      organizationId: "org-cloud-customer",
    });
    expect(license.instanceBoundAt).not.toBeNull();
  });

  /** @scenario "A testing license cannot be reset onto another instance or turned standard" */
  it("refuses a reset of its instance binding and keeps the binding", async () => {
    const { registry, testingLicenseKey } = harness();
    const license = await registry.record({ licenseKey: testingLicenseKey(), source: "SCRIPT" });

    const code = await codeOf(registry.resetInstanceBinding({ id: license.id }));

    expect(code).toBe("testing_license_binding_reset_refused");
    await expect(registry.getById({ id: license.id })).resolves.toMatchObject({
      instanceId: "instance-a",
    });
  });

  /** @scenario "A testing license cannot be reset onto another instance or turned standard" */
  it("reissues as a testing licence for the same instance and organization", async () => {
    const { registry, cryptography, testingLicenseKey } = harness();
    const license = await registry.record({ licenseKey: testingLicenseKey(), source: "SCRIPT" });

    const reissued = await registry.reissue({
      id: license.id,
      expiresAt: Temporal.Instant.from("2026-01-08T00:00:00.000Z"),
      operatorId: "operator-1",
    });

    expect(reissued.license).toMatchObject({
      kind: "testing",
      instanceId: "instance-a",
      testingOrganizationId: "org-local",
    });
    expect(cryptography.parseLicenseKey(reissued.licenseKey)?.data).toMatchObject({
      kind: "testing",
      instanceId: "instance-a",
      organizationId: "org-local",
    });
  });
});

describe("given a customer holding a standard licence and a testing licence", () => {
  /** @scenario "Testing licenses never count towards seats or invoices" */
  it("counts only the standard licence's seats, seat changes and onboarding", async () => {
    const { registry, organizations, testingLicenseKey } = harness();
    await registry.issue({
      customer: { organizationId: "org-acme" },
      email: "ops@acme.test",
      planType: "ENTERPRISE",
      maxMembers: 50,
      expiresAt: TERM_END,
      operatorId: "operator-1",
    });
    const testing = await registry.registerLegacy({
      licenseKey: testingLicenseKey(),
      organizationId: "org-acme",
      operatorId: "operator-1",
    });

    const seatChange = await registry.changeSeats({
      id: testing.id,
      maxMembers: 400,
      operatorId: "operator-1",
    });

    expect(seatChange.billing).toBe("nothing_to_invoice");
    await expect(registry.findSeatChanges({ organizationId: "org-acme" })).resolves.toEqual([]);
    await expect(registry.getConnectedSeats("org-acme")).resolves.toMatchObject({ licensed: 50 });
    expect(organizations.marked).toEqual(["org-acme"]);
  });

  /** @scenario "Testing licenses never count towards seats or invoices" */
  it("adds nothing to the contract totals", async () => {
    const { registry, repository, testingLicenseKey } = harness();
    const standard = await registry.issue({
      customer: { organizationId: "org-acme" },
      email: "ops@acme.test",
      planType: "ENTERPRISE",
      maxMembers: 50,
      expiresAt: TERM_END,
      operatorId: "operator-1",
      terms: { commitUsdCents: 100_000 },
    });
    const testing = await registry.record({
      licenseKey: testingLicenseKey(),
      source: "SCRIPT",
      organizationId: "org-acme",
    });
    await repository.update(testing.id, { commitUsdCents: 900_000, overageEnabled: true });

    const terms = contractTermsOf({
      licenses: await repository.findAllByOrganization("org-acme"),
      now: NOW,
    });

    expect(standard.license.kind).toBe("standard");
    expect(terms).toMatchObject({
      commitUsdCents: 100_000,
      overageEnabled: false,
      termEndsAt: TERM_END.toString(),
    });
  });
});

describe("given a registry row with a kind this release does not know", () => {
  async function partnerRow() {
    const context = harness();
    const { license } = await context.registry.issue({
      customer: { organizationId: "org-acme" },
      email: "ops@acme.test",
      planType: "ENTERPRISE",
      maxMembers: 50,
      expiresAt: TERM_END,
      operatorId: "operator-1",
      terms: { commitUsdCents: 100_000 },
    });
    await context.repository.update(license.id, { kind: "partner" });
    return { ...context, id: license.id };
  }

  /** @scenario "Testing licenses never count towards seats or invoices" */
  it("shows the kind as stored and counts it towards nothing", async () => {
    const { registry, repository, id } = await partnerRow();

    await expect(registry.getById({ id })).resolves.toMatchObject({ kind: "partner" });
    await expect(registry.getConnectedSeats("org-acme")).resolves.toMatchObject({ licensed: 0 });
    const terms = contractTermsOf({
      licenses: await repository.findAllByOrganization("org-acme"),
      now: NOW,
    });
    expect(terms.commitUsdCents).toBe(0);
  });

  /** @scenario "A testing license cannot be reset onto another instance or turned standard" */
  it("refuses a reset of its instance binding like a testing licence", async () => {
    const { registry, id } = await partnerRow();

    const code = await codeOf(registry.resetInstanceBinding({ id }));

    expect(code).toBe("testing_license_binding_reset_refused");
  });
});
