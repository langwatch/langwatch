import {
  LicenseGenerationService,
  NodeLicenseCryptographyService,
} from "@langwatch/enterprise-license-signing";
import {
  IssuedLicenseNotActiveError,
  IssuedLicenseNotFoundError,
  LicenseAlreadyRegisteredError,
  LicenseKeyInvalidError,
  LicenseOverageMaxRequiresOverageError,
  LicenseSigningNotConfiguredError,
  type IssuedLicenseCustomerRecord,
} from "@langwatch/enterprise-licensing-contract";
import { registryHashForToken } from "@langwatch/gateway-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  TEST_PRIVATE_KEY,
  TEST_PUBLIC_KEY,
} from "../../__tests__/fixtures/license-keys.fixture.ts";
import type { ConnectManagedKeys } from "../../app/licensing.members.ts";
import { MemoryIssuedLicenseRepository } from "../../repositories/memory/memory.issued-license.repository.ts";
import { LicenseRegistryService } from "../license-registry.service.ts";

const NOW: Instant = Temporal.Instant.from("2026-01-01T00:00:00.000Z");
const TERM_END: Instant = Temporal.Instant.from("2027-01-01T00:00:00.000Z");

class RecordingCustomers {
  readonly marked: string[] = [];
  readonly created: string[] = [];

  async findById(id: string): Promise<IssuedLicenseCustomerRecord | null> {
    return id === "missing" ? null : { id, name: "ACME" };
  }

  async createSelfHostedCustomer({ name }: { name: string }): Promise<IssuedLicenseCustomerRecord> {
    this.created.push(name);
    return { id: `org-${this.created.length}`, name };
  }

  async markSelfHostedCustomer(id: string): Promise<void> {
    this.marked.push(id);
  }
}

class RecordingManagedKeys {
  readonly retired: string[] = [];
  readonly invalidated: string[] = [];
  readonly licensed: Parameters<ConnectManagedKeys["setLicense"]>[0][] = [];
  readonly published: { virtualKeyId: string; services: string[] }[] = [];
  #minted = 0;

  async provision(): Promise<{ id: string }> {
    this.#minted += 1;
    return { id: `vk-${this.#minted}` };
  }

  async retire({ virtualKeyId }: { virtualKeyId: string }): Promise<void> {
    this.retired.push(virtualKeyId);
  }

  async invalidate({ virtualKeyId }: { virtualKeyId: string }): Promise<void> {
    this.invalidated.push(virtualKeyId);
  }
  async setConnectServices({
    virtualKeyId,
    services,
  }: {
    virtualKeyId: string;
    services: readonly string[];
  }): Promise<void> {
    this.published.push({ virtualKeyId, services: [...services] });
  }
  async setLicense(facts: Parameters<ConnectManagedKeys["setLicense"]>[0]): Promise<void> {
    this.licensed.push(facts);
  }
}

class RecordingBudgets {
  readonly synced: string[] = [];

  async sync({ organizationId }: { organizationId: string }): Promise<void> {
    this.synced.push(organizationId);
  }
}

function harness({
  signingKey = TEST_PRIVATE_KEY,
  organizations = new RecordingCustomers(),
}: { signingKey?: string; organizations?: RecordingCustomers } = {}) {
  const repository = MemoryIssuedLicenseRepository.create();
  const managedKeys = new RecordingManagedKeys();
  const contractBudgets = new RecordingBudgets();
  const cryptography = NodeLicenseCryptographyService.create({ publicKey: TEST_PUBLIC_KEY });
  const registry = LicenseRegistryService.create({
    repository,
    organizations,
    managedKeys,
    contractBudgets,
    cryptography,
    generation: LicenseGenerationService.create(cryptography),
    cipher: { encrypt: (plain) => `sealed:${plain}`, decrypt: (cipher) => cipher.slice(7) },
    signingKey: () => signingKey,
    now: () => NOW,
  });
  return {
    registry,
    repository,
    organizations,
    managedKeys,
    contractBudgets,
    cryptography,
  };
}

type IssueInput = Parameters<LicenseRegistryService["issue"]>[0];

function issueInput(overrides: Partial<IssueInput> = {}): IssueInput {
  const base: IssueInput = {
    customer: { organizationId: "org-acme" },
    email: "ops@example.com",
    planType: "ENTERPRISE",
    maxMembers: 50,
    expiresAt: TERM_END,
    operatorId: "operator-1",
  };
  return Object.assign(base, overrides);
}

describe("the license registry", () => {
  /** @scenario "A license issued from the backoffice is recorded" */
  /** @scenario A customer organization is marked as a self-hosted customer */
  /** @scenario Issuing a license never asks the operator for the private key */
  it("records the license it signs, active, linked and unbound", async () => {
    const { registry, organizations, contractBudgets } = harness();

    const { licenseKey, license } = await registry.issue(issueInput());

    expect(licenseKey).not.toBe("");
    expect(license.organizationId).toBe("org-acme");
    expect(license.maxMembers).toBe(50);
    expect(license.issuedById).toBe("operator-1");
    expect(license.status).toBe("active");
    expect(license.instanceId).toBeNull();
    expect(organizations.marked).toEqual(["org-acme"]);
    expect(contractBudgets.synced).toEqual(["org-acme"]);
  });

  /** @scenario A license is written only once its customer is marked */
  it("writes no row when marking the customer fails, so issuing again is not a duplicate", async () => {
    class FailingCustomers extends RecordingCustomers {
      failing = true;

      override async markSelfHostedCustomer(id: string): Promise<void> {
        if (this.failing) throw new Error("the organization store is down");
        await super.markSelfHostedCustomer(id);
      }
    }
    const organizations = new FailingCustomers();
    const { registry, repository } = harness({ organizations });

    await expect(registry.issue(issueInput())).rejects.toThrow("the organization store is down");
    expect(await repository.findAllByOrganization("org-acme")).toEqual([]);

    organizations.failing = false;
    await expect(registry.issue(issueInput())).resolves.toMatchObject({
      license: { organizationId: "org-acme" },
    });
  });

  /** @scenario "The registry stores a hash of the token, not the token" */
  it("stores the second hash of the token and never the token itself", async () => {
    const { registry, repository, cryptography } = harness();

    const { licenseKey, license } = await registry.issue(issueInput());

    const token = cryptography.getLicenseToken(licenseKey);
    const row = await repository.findById(license.id);
    expect(row?.tokenHash).toBe(await registryHashForToken(token));
    expect(row?.tokenHash).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(licenseKey);
  });

  /** @scenario "Issuing is refused when no signing key is configured" */
  it("refuses to issue when the deployment holds no signing key", async () => {
    const { registry } = harness({ signingKey: "" });

    await expect(registry.issue(issueInput())).rejects.toBeInstanceOf(
      LicenseSigningNotConfiguredError,
    );
  });

  /** @scenario "Registering the same license twice is refused" */
  it("refuses the same license a second time and leaves the first row alone", async () => {
    const { registry } = harness();
    const { licenseKey } = await registry.issue(issueInput());

    await expect(registry.record({ licenseKey, source: "SCRIPT" })).rejects.toBeInstanceOf(
      LicenseAlreadyRegisteredError,
    );
  });

  /** @scenario "Revoking a license" */
  /** @scenario Revoking a license revokes its managed key */
  it("revokes the row and ends its managed key first", async () => {
    const { registry, repository, managedKeys } = harness();
    const { license } = await registry.issue(issueInput());
    await repository.update(license.id, { virtualKeyId: "vk-live" });

    const revoked = await registry.revoke({
      id: license.id,
      operatorId: "operator-2",
      reason: "contract ended",
    });

    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedById).toBe("operator-2");
    expect(revoked.revokedReason).toBe("contract ended");
    expect(managedKeys.retired).toEqual(["vk-live"]);
  });

  /** @scenario "Reissuing a license" */
  it("signs a replacement that points at the license it replaces", async () => {
    const { registry, repository } = harness();
    const { license } = await registry.issue(issueInput());

    const reissued = await registry.reissue({
      id: license.id,
      maxMembers: 80,
      expiresAt: Temporal.Instant.from("2028-01-01T00:00:00.000Z"),
      operatorId: "operator-3",
    });

    expect(reissued.license.replacesId).toBe(license.id);
    expect(reissued.license.maxMembers).toBe(80);
    expect(reissued.license.hasPendingDelivery).toBe(true);
    // The replaced license stays valid until the install presents the new one.
    const replaced = await repository.findById(license.id);
    expect(replaced?.supersededAt).toBeNull();
  });

  /** @scenario "Resetting the instance binding" */
  it("clears the binding and makes every gateway resolve the license again", async () => {
    const { registry, repository, managedKeys } = harness();
    const { license } = await registry.issue(issueInput());
    await repository.update(license.id, {
      instanceId: "install-1",
      instanceBoundAt: NOW,
      virtualKeyId: "vk-live",
    });

    const reset = await registry.resetInstanceBinding({ id: license.id });

    expect(reset.instanceId).toBeNull();
    expect(reset.instanceBoundAt).toBeNull();
    expect(managedKeys.invalidated).toEqual(["vk-live"]);
    expect(managedKeys.licensed).toEqual([
      expect.objectContaining({ virtualKeyId: "vk-live", instanceId: null }),
    ]);
  });

  /** @scenario "Editing entitlements does not reissue the license" */
  it("switches a hosted service on without signing anything", async () => {
    const { registry } = harness();
    const { licenseKey, license } = await registry.issue(issueInput());

    const updated = await registry.updateTerms({
      id: license.id,
      operatorId: "operator-4",
      services: ["instant_evals"],
    });

    expect(updated.services).toEqual(["instant_evals"]);
    expect(updated.licenseId).toBe(license.licenseId);
    const { licenses } = await registry.list({ page: 0, pageSize: 10 });
    expect(licenses).toHaveLength(1);
    expect(licenseKey).not.toBe("");
  });

  it("tells the gateway what the license's managed key may now serve", async () => {
    const { registry, repository, managedKeys } = harness();
    const { license } = await registry.issue(issueInput());
    await repository.update(license.id, { virtualKeyId: "vk-live" });

    await registry.updateTerms({
      id: license.id,
      operatorId: "operator-4",
      services: ["instant_evals", "managed_models"],
    });

    expect(managedKeys.published).toEqual([
      { virtualKeyId: "vk-live", services: ["instant_evals", "managed_models"] },
    ]);
  });

  /** @scenario "A license past its term reads as expired" */
  it("reads a license past its term as expired without editing the row", async () => {
    const { registry, repository } = harness();
    const { license } = await registry.issue(issueInput());
    await repository.update(license.id, {
      expiresAt: Temporal.Instant.from("2025-01-01T00:00:00.000Z"),
    });

    const read = await registry.getById({ id: license.id });

    expect(read.status).toBe("expired");
    expect(read.revokedAt).toBeNull();
    expect(read.supersededAt).toBeNull();
  });

  it("refuses a seat change on a license that is no longer active", async () => {
    const { registry, repository } = harness();
    const { license } = await registry.issue(issueInput());
    await repository.update(license.id, { revokedAt: NOW });

    await expect(
      registry.changeSeats({ id: license.id, maxMembers: 80, operatorId: "operator-5" }),
    ).rejects.toBeInstanceOf(IssuedLicenseNotActiveError);
  });

  it("leaves billing only the seats a mid-term change added", async () => {
    const { registry } = harness();
    const { license } = await registry.issue(issueInput());

    const changed = await registry.changeSeats({
      id: license.id,
      maxMembers: 58,
      operatorId: "operator-6",
    });

    expect(changed.previousMaxMembers).toBe(50);
    expect(changed.billing).toBe("pending");
    await expect(registry.findSeatChanges({})).resolves.toMatchObject([
      { previousSeats: 50, seats: 58 },
    ]);
    expect(changed.license.expiresAt).toBe(TERM_END.toString());
  });
});

describe("raising the prepaid commit", () => {
  it("raises it on the customer's longest-running active license", async () => {
    const { registry, repository } = harness();
    const shorter = await registry.issue(
      issueInput({
        expiresAt: Temporal.Instant.from("2026-06-01T00:00:00.000Z"),
        terms: { commitUsdCents: 50_000 },
      }),
    );
    const longer = await registry.issue(
      issueInput({ email: "finance@example.com", terms: { commitUsdCents: 100_000 } }),
    );

    await registry.raiseCommit({
      organizationId: "org-acme",
      byUsdCents: 25_000,
      operatorId: "operator-1",
    });

    expect((await repository.findById(longer.license.id))?.commitUsdCents).toBe(125_000);
    expect((await repository.findById(shorter.license.id))?.commitUsdCents).toBe(50_000);
  });

  it("refuses by name where the customer holds no active license", async () => {
    const { registry } = harness();

    await expect(
      registry.raiseCommit({
        organizationId: "org-acme",
        byUsdCents: 25_000,
        operatorId: "operator-1",
      }),
    ).rejects.toBeInstanceOf(IssuedLicenseNotFoundError);
  });
});

describe("licenses another flow signed", () => {
  function purchased(): string {
    return LicenseGenerationService.create(NodeLicenseCryptographyService.create()).generate({
      organizationName: "ACME",
      email: "buyer@acme.test",
      planType: "GROWTH",
      maxMembers: 10,
      privateKey: TEST_PRIVATE_KEY,
      now: new Date("2026-01-01T00:00:00.000Z"),
    }).licenseKey;
  }

  it("records a purchased license without a customer organization", async () => {
    const { registry } = harness();

    const license = await registry.record({ licenseKey: purchased(), source: "PURCHASE" });

    expect(license).toMatchObject({
      organizationId: null,
      source: "PURCHASE",
      issuedById: null,
      maxMembers: 10,
    });
  });

  /** @scenario "A license minted by the command line script is recorded" */
  it("links a scripted license to its organization without calling it a self-hosted customer", async () => {
    const { registry, organizations } = harness();

    const license = await registry.record({
      licenseKey: purchased(),
      source: "SCRIPT",
      organizationId: "org-acme",
    });

    expect(license).toMatchObject({ organizationId: "org-acme", source: "SCRIPT" });
    expect(organizations.marked).toEqual([]);
  });

  /** @scenario "An operator links a recorded license to a customer organization" */
  it("links a recorded license and marks the organization a self-hosted customer", async () => {
    const { registry, organizations } = harness();
    const license = await registry.record({ licenseKey: purchased(), source: "PURCHASE" });

    const linked = await registry.linkToOrganization({
      id: license.id,
      organizationId: "org-acme",
      operatorId: "operator-7",
    });

    expect(linked.organizationId).toBe("org-acme");
    expect(organizations.marked).toEqual(["org-acme"]);
  });
});

describe("changing the seats of a running license", () => {
  /** @scenario "An operator changes the seats of a running license" */
  it("signs a replacement for the same term and records the seat change billing reads", async () => {
    const { registry, repository, cryptography } = harness();
    const { license } = await registry.issue(issueInput());

    const result = await registry.changeSeats({
      id: license.id,
      maxMembers: 58,
      operatorId: "operator-8",
    });

    expect(result.license).toMatchObject({
      maxMembers: 58,
      replacesId: license.id,
      expiresAt: TERM_END.toString(),
      hasPendingDelivery: true,
    });
    expect(cryptography.parseLicenseKey(result.licenseKey)?.data.plan.maxMembers).toBe(58);
    expect(result.billing).toBe("pending");
    expect((await repository.findById(result.license.id))?.seatsRaisedFrom).toBe(50);
    await expect(registry.findSeatChanges({ organizationId: "org-acme" })).resolves.toEqual([
      {
        licenseRowId: result.license.id,
        organizationId: "org-acme",
        previousSeats: 50,
        seats: 58,
        changedAt: NOW.toString(),
      },
    ]);
    await expect(registry.findSeatChanges({ organizationId: "org-other" })).resolves.toEqual([]);
  });

  /** @scenario "Seats raised on a license linked to no customer leave billing nothing to invoice" */
  it("signs a replacement for an unlinked license and records no seat change", async () => {
    const { registry, repository } = harness();
    const { license } = await registry.issue(issueInput());
    await repository.update(license.id, { organizationId: null });

    const result = await registry.changeSeats({
      id: license.id,
      maxMembers: 58,
      operatorId: "operator-8",
    });

    expect(result.license.maxMembers).toBe(58);
    expect(result.billing).toBe("nothing_to_invoice");
    await expect(registry.findSeatChanges({})).resolves.toEqual([]);
  });

  /** @scenario "Seats that went down are not credited back mid-term" */
  it("signs a replacement for fewer seats and records no seat change", async () => {
    const { registry } = harness();
    const { license } = await registry.issue(issueInput());

    const result = await registry.changeSeats({
      id: license.id,
      maxMembers: 40,
      operatorId: "operator-8",
    });

    expect(result.license.maxMembers).toBe(40);
    expect(result.billing).toBe("nothing_to_invoice");
    await expect(registry.findSeatChanges({})).resolves.toEqual([]);
  });

  it("refuses a second change on the license the first one replaced", async () => {
    const { registry } = harness();
    const { license } = await registry.issue(issueInput());
    await registry.changeSeats({ id: license.id, maxMembers: 58, operatorId: "operator-8" });

    await expect(
      registry.changeSeats({ id: license.id, maxMembers: 60, operatorId: "operator-8" }),
    ).rejects.toMatchObject({ code: "license_already_reissued" });
  });

  /** @scenario "Seats changed on a revoked license are refused" */
  it("refuses a revoked license and records no seat change", async () => {
    const { registry } = harness();
    const { license } = await registry.issue(issueInput());
    await registry.revoke({ id: license.id, operatorId: "operator-8", reason: "leaked" });

    await expect(
      registry.changeSeats({ id: license.id, maxMembers: 58, operatorId: "operator-8" }),
    ).rejects.toMatchObject({ code: "issued_license_not_active" });
    await expect(registry.findSeatChanges({})).resolves.toEqual([]);
  });
});

describe("the seats a connected customer holds", () => {
  it("reads nothing licensed and nothing reported for a customer with no license", async () => {
    const { registry } = harness();

    await expect(registry.getConnectedSeats("org-acme")).resolves.toEqual({
      licensed: 0,
      reported: null,
      lastSyncAt: null,
      managedVirtualKeyId: null,
    });
  });

  it("reports the seats as not known while the install has never synced", async () => {
    const { registry } = harness();
    await registry.issue(issueInput());

    await expect(registry.getConnectedSeats("org-acme")).resolves.toMatchObject({
      licensed: 50,
      reported: null,
      lastSyncAt: null,
    });
  });

  it("reads the longest-running active license once, not a reissue and its original together", async () => {
    const { registry, repository } = harness();
    const { license } = await registry.issue(issueInput());
    const synced = Temporal.Instant.from("2026-06-01T06:00:00.000Z");
    await repository.update(license.id, {
      lastSyncAt: synced,
      reportedMembers: 44,
      virtualKeyId: "vk-managed",
    });
    const { license: longer } = await registry.reissue({
      id: license.id,
      maxMembers: 60,
      expiresAt: Temporal.Instant.from("2027-06-01T00:00:00.000Z"),
      operatorId: "operator-9",
    });
    await repository.update(longer.id, {
      lastSyncAt: Temporal.Instant.from("2026-06-02T06:00:00.000Z"),
      reportedMembers: 47,
    });

    await expect(registry.getConnectedSeats("org-acme")).resolves.toEqual({
      licensed: 60,
      reported: 47,
      lastSyncAt: "2026-06-02T06:00:00Z",
      managedVirtualKeyId: "vk-managed",
    });
  });
});

describe("registering a license signed before the registry existed", () => {
  /** @scenario "A license issued before the registry existed is registered by pasting it" */
  it("verifies the signature and reads the seats and term from the license", async () => {
    const { licenseKey } = await harness().registry.issue(issueInput({ maxMembers: 7 }));
    const { registry, organizations } = harness();

    const view = await registry.registerLegacy({
      licenseKey,
      organizationId: "org-acme",
      operatorId: "operator-2",
    });

    expect(view.organizationId).toBe("org-acme");
    expect(view.maxMembers).toBe(7);
    expect(view.status).toBe("active");
    expect(organizations.marked).toEqual(["org-acme"]);
  });

  /** @scenario "A pasted license with a bad signature is refused" */
  it("refuses a license edited after signing and writes nothing", async () => {
    const { licenseKey } = await harness().registry.issue(issueInput({ maxMembers: 7 }));
    const signed = JSON.parse(Buffer.from(licenseKey, "base64").toString("utf-8"));
    signed.data.plan.maxMembers = 5000;
    const edited = Buffer.from(JSON.stringify(signed)).toString("base64");
    const { registry, organizations } = harness();

    await expect(
      registry.registerLegacy({
        licenseKey: edited,
        organizationId: "org-acme",
        operatorId: "operator-2",
      }),
    ).rejects.toBeInstanceOf(LicenseKeyInvalidError);
    expect((await registry.list({ page: 0, pageSize: 10 })).licenses).toEqual([]);
    expect(organizations.marked).toEqual([]);
  });
});

describe("the commercial terms on a registry row", () => {
  /** @scenario "Commercial terms are set on the registry row" */
  it("records the seat rate, the commit and the overage terms", async () => {
    const { registry, repository } = harness();
    const { license } = await registry.issue(issueInput());

    await registry.updateTerms({
      id: license.id,
      operatorId: "operator-3",
      seatRateCents: 60_000,
      seatCurrency: "USD",
      commitUsdCents: 100_000,
      overageEnabled: true,
      overageMaxUsdCents: 50_000,
    });

    expect(await repository.findById(license.id)).toMatchObject({
      seatRateCents: 60_000,
      commitUsdCents: 100_000,
      overageEnabled: true,
      overageMaxUsdCents: 50_000,
    });
  });

  /** @scenario "An overage maximum without overage enabled is refused" */
  it("refuses a maximum while on-demand overage is off", async () => {
    const { registry, repository } = harness();
    const { license } = await registry.issue(issueInput());

    await expect(
      registry.updateTerms({
        id: license.id,
        operatorId: "operator-3",
        overageEnabled: false,
        overageMaxUsdCents: 50_000,
      }),
    ).rejects.toBeInstanceOf(LicenseOverageMaxRequiresOverageError);
    expect(await repository.findById(license.id)).toMatchObject({ overageEnabled: false });
  });
});
