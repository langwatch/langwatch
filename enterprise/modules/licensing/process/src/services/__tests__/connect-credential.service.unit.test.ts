import { registryHashForToken } from "@langwatch/gateway-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { ConnectManagedKeys } from "../../app/licensing.members.ts";
import { TEST_PUBLIC_KEY } from "../../fixtures/license-keys.fixture.ts";
import type { IssuedLicenseRecord } from "../../repositories/issued-license.repository.ts";
import { MemoryIssuedLicenseRepository } from "../../repositories/memory/memory.issued-license.repository.ts";
import { ConnectCredentialService } from "../connect-credential.service.ts";
import { LicenseSyncService } from "../license-sync.service.ts";
import { NodeLicenseCryptographyAdapter } from "../node-license-cryptography.service.ts";

const NOW: Instant = Temporal.Instant.from("2026-01-01T00:00:00.000Z");
const TOKEN = `lwl_${"a".repeat(64)}`;
const OTHER_TOKEN = `lwl_${"b".repeat(64)}`;
const TOKEN_HASH = await registryHashForToken(TOKEN);
const OTHER_TOKEN_HASH = await registryHashForToken(OTHER_TOKEN);

const cryptography = NodeLicenseCryptographyAdapter.create({ publicKey: TEST_PUBLIC_KEY });

function rowFor(overrides: Partial<IssuedLicenseRecord> = {}): IssuedLicenseRecord {
  return {
    id: "license-1",
    licenseId: "lic-1",
    tokenHash: TOKEN_HASH,
    organizationId: "org-acme",
    organizationName: "ACME",
    email: "ops@example.com",
    planType: "ENTERPRISE",
    maxMembers: 50,
    maxMembersLite: 0,
    issuedAt: Temporal.Instant.from("2025-12-01T00:00:00.000Z"),
    expiresAt: Temporal.Instant.from("2027-01-01T00:00:00.000Z"),
    source: "BACKOFFICE",
    issuedById: "operator-1",
    revokedAt: null,
    revokedById: null,
    revokedReason: null,
    supersededAt: null,
    replacesId: null,
    pendingDeliveryLicense: null,
    services: ["instant_evals"],
    seatRateCents: null,
    seatCurrency: null,
    commitUsdCents: 0,
    overageEnabled: false,
    overageMaxUsdCents: null,
    instanceId: null,
    instanceBoundAt: null,
    lastSyncAt: null,
    lastSyncVersion: null,
    reportedMembers: null,
    reportedMembersLite: null,
    virtualKeyId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

class RecordingManagedKeys {
  readonly retired: string[] = [];
  readonly published: { virtualKeyId: string; services: string[] }[] = [];
  readonly licensed: Parameters<ConnectManagedKeys["setLicense"]>[0][] = [];
  #minted = 0;

  async provision(): Promise<{ id: string }> {
    this.#minted += 1;
    return { id: `vk-${this.#minted}` };
  }

  async retire({ virtualKeyId }: { virtualKeyId: string }): Promise<void> {
    this.retired.push(virtualKeyId);
  }

  async invalidate(): Promise<void> {}

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

function harness(rows: IssuedLicenseRecord[]) {
  const repository = MemoryIssuedLicenseRepository.create(rows);
  const managedKeys = new RecordingManagedKeys();
  const credentials = ConnectCredentialService.create({
    repository,
    managedKeys,
    cryptography,
    systemActorId: "system",
    now: () => NOW,
  });
  return { repository, managedKeys, credentials };
}

describe("resolving a license token", () => {
  /** @scenario "A malformed license token is refused before any lookup" */
  it("refuses a token that is not shaped like one, without reading the registry", async () => {
    const { credentials } = harness([]);

    const resolution = await credentials.resolve({ token: "nope", instanceId: "install-1" });

    expect(resolution).toEqual({ ok: false, code: "connect_license_token_malformed" });
  });

  /** @scenario "A license token with no instance id is refused" */
  it("refuses a token presented without an instance id", async () => {
    const { credentials } = harness([rowFor()]);

    const resolution = await credentials.resolve({ token: TOKEN, instanceId: "  " });

    expect(resolution).toEqual({ ok: false, code: "connect_instance_required" });
  });

  /** @scenario "An unregistered license is refused" */
  it("refuses a token the registry does not hold, and an unlinked one the same way", async () => {
    const { credentials } = harness([rowFor({ organizationId: null })]);

    await expect(
      credentials.resolve({ token: OTHER_TOKEN, instanceId: "install-1" }),
    ).resolves.toEqual({ ok: false, code: "connect_license_not_registered" });
    await expect(credentials.resolve({ token: TOKEN, instanceId: "install-1" })).resolves.toEqual({
      ok: false,
      code: "connect_license_not_registered",
    });
  });

  /** @scenario "A revoked license is refused" */
  it("refuses a revoked license", async () => {
    const { credentials } = harness([rowFor({ revokedAt: NOW })]);

    await expect(credentials.resolve({ token: TOKEN, instanceId: "install-1" })).resolves.toEqual({
      ok: false,
      code: "connect_license_revoked",
    });
  });

  /** @scenario "An expired license is refused" */
  it("refuses a license whose term has ended", async () => {
    const { credentials } = harness([
      rowFor({ expiresAt: Temporal.Instant.from("2025-06-01T00:00:00.000Z") }),
    ]);

    await expect(credentials.resolve({ token: TOKEN, instanceId: "install-1" })).resolves.toEqual({
      ok: false,
      code: "connect_license_expired",
    });
  });

  /** @scenario "The first instance to present a license is bound to it" */
  it("binds the first install that presents it and mints its managed key", async () => {
    const { credentials, repository } = harness([rowFor()]);

    const resolution = await credentials.resolve({ token: TOKEN, instanceId: "install-1" });

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.virtualKeyId).toBe("vk-1");
    const row = await repository.findById("license-1");
    expect(row?.instanceId).toBe("install-1");
    expect(row?.instanceBoundAt).toEqual(NOW);
  });

  /** @scenario "The managed key is created on first use and reused after" */
  it("reuses the managed key on every call after the first", async () => {
    const { credentials } = harness([rowFor()]);

    const first = await credentials.resolve({ token: TOKEN, instanceId: "install-1" });
    const second = await credentials.resolve({ token: TOKEN, instanceId: "install-1" });

    expect(first.ok && first.virtualKeyId).toBe("vk-1");
    expect(second.ok && second.virtualKeyId).toBe("vk-1");
  });

  it("writes the facts the gateway resolves the token by onto the managed key, every time", async () => {
    const { credentials, managedKeys, repository } = harness([rowFor()]);

    await credentials.resolve({ token: TOKEN, instanceId: "install-1" });
    await credentials.resolve({ token: TOKEN, instanceId: "install-1" });

    const row = await repository.findById("license-1");
    const facts = {
      virtualKeyId: "vk-1",
      organizationId: row?.organizationId,
      tokenHash: TOKEN_HASH,
      instanceId: "install-1",
      expiresAt: row?.expiresAt,
    };
    expect(managedKeys.licensed).toEqual([facts, facts]);
  });

  it("writes nothing for a token it refuses", async () => {
    const { credentials, managedKeys } = harness([rowFor({ revokedAt: NOW })]);

    await credentials.resolve({ token: TOKEN, instanceId: "install-1" });

    expect(managedKeys.licensed).toEqual([]);
  });

  /** @scenario "A license token replayed from another instance is refused" */
  it("refuses a bound license presented by another install", async () => {
    const { credentials } = harness([rowFor({ instanceId: "install-1", instanceBoundAt: NOW })]);

    await expect(credentials.resolve({ token: TOKEN, instanceId: "install-2" })).resolves.toEqual({
      ok: false,
      code: "connect_wrong_instance",
    });
  });
});

describe("a license sync", () => {
  function syncHarness(rows: IssuedLicenseRecord[], { allow = true }: { allow?: boolean } = {}) {
    const { repository, managedKeys, credentials } = harness(rows);
    const sync = LicenseSyncService.create({
      credentials,
      repository,
      managedKeys,
      rateLimit: { allow: () => Promise.resolve(allow) },
      cipher: { encrypt: (plain) => `sealed:${plain}`, decrypt: (cipher) => cipher.slice(7) },
      systemActorId: "system",
      now: () => NOW,
    });
    return { repository, managedKeys, sync };
  }

  const body = { version: "1.2.3", seats: { members: 12, liteMembers: 3 } };

  /** @scenario "The last report replaces the one before it" */
  it("records the last report and answers the entitled services", async () => {
    const { sync, repository } = syncHarness([rowFor()]);

    const result = await sync.recordSync({ token: TOKEN, instanceId: "install-1", body });

    expect(result).toEqual({ ok: true, services: ["instant_evals"] });
    const row = await repository.findById("license-1");
    expect(row?.lastSyncAt).toEqual(NOW);
    expect(row?.lastSyncVersion).toBe("1.2.3");
    expect(row?.reportedMembers).toBe(12);
    expect(row?.reportedMembersLite).toBe(3);
  });

  it("tells the gateway the services the license grants, on the key's first use and every sync", async () => {
    const { sync, managedKeys } = syncHarness([rowFor({ services: ["managed_models"] })]);

    await sync.recordSync({ token: TOKEN, instanceId: "install-1", body });

    expect(managedKeys.published).toEqual([
      { virtualKeyId: "vk-1", services: ["managed_models"] },
      { virtualKeyId: "vk-1", services: ["managed_models"] },
    ]);
  });

  it("tells the gateway a license granting nothing serves nothing", async () => {
    const { sync, managedKeys } = syncHarness([
      rowFor({ services: [], instanceId: "install-1", instanceBoundAt: NOW, virtualKeyId: "vk-9" }),
    ]);

    await sync.recordSync({ token: TOKEN, instanceId: "install-1", body });

    expect(managedKeys.published).toEqual([{ virtualKeyId: "vk-9", services: [] }]);
  });

  /** @scenario "A sync with a malformed payload is refused" */
  it("refuses a payload that carries anything but the version and the seats", async () => {
    const { sync, repository } = syncHarness([rowFor()]);

    const result = await sync.recordSync({
      token: TOKEN,
      instanceId: "install-1",
      body: { ...body, organizationName: "ACME" },
    });

    expect(result).toEqual({ ok: false, code: "validation_error" });
    expect((await repository.findById("license-1"))?.lastSyncAt).toBeNull();
  });

  /** @scenario "Sync is rate limited per license" */
  it("refuses a license that has synced too many times today", async () => {
    const { sync } = syncHarness([rowFor()], { allow: false });

    await expect(sync.recordSync({ token: TOKEN, instanceId: "install-1", body })).resolves.toEqual(
      { ok: false, code: "rate_limited" },
    );
  });

  /** @scenario "A sync from an unregistered, revoked or wrong-instance license is refused" */
  it("carries the credential's own refusal through", async () => {
    const { sync } = syncHarness([rowFor({ revokedAt: NOW })]);

    await expect(sync.recordSync({ token: TOKEN, instanceId: "install-1", body })).resolves.toEqual(
      { ok: false, code: "connect_license_revoked" },
    );
  });

  it("answers the connect host from the bearer header, and throws a refusal by its code", async () => {
    const { sync } = syncHarness([rowFor()]);

    await expect(
      sync.answer({ authorization: `Bearer ${TOKEN}`, instanceId: "install-1", body }),
    ).resolves.toEqual({ services: ["instant_evals"] });
    await expect(
      sync.answer({ authorization: TOKEN, instanceId: "install-1", body }),
    ).rejects.toMatchObject({ code: "connect_license_token_malformed", httpStatus: 401 });
  });

  it("delivers a reissued license until the install presents it", async () => {
    const replacement = rowFor({
      id: "license-2",
      licenseId: "lic-2",
      tokenHash: OTHER_TOKEN_HASH,
      replacesId: "license-1",
      pendingDeliveryLicense: "sealed:new-license-key",
      instanceId: "install-1",
      instanceBoundAt: NOW,
    });
    const { sync, repository, managedKeys } = syncHarness([
      rowFor({ instanceId: "install-1", instanceBoundAt: NOW, virtualKeyId: "vk-old" }),
      replacement,
    ]);

    const held = await sync.recordSync({ token: TOKEN, instanceId: "install-1", body });
    expect(held).toEqual({ ok: true, services: ["instant_evals"], license: "new-license-key" });

    // Presenting the new token is what retires the license it replaced.
    const applied = await sync.recordSync({ token: OTHER_TOKEN, instanceId: "install-1", body });
    expect(applied).toEqual({ ok: true, services: ["instant_evals"] });
    expect(managedKeys.retired).toContain("vk-old");
    expect((await repository.findById("license-1"))?.supersededAt).toEqual(NOW);
    expect((await repository.findById("license-2"))?.pendingDeliveryLicense).toBeNull();
  });
});

describe("the services a managed key is entitled to", () => {
  it("names the entitlements of the active license that holds the key", async () => {
    const { credentials } = harness([
      rowFor({ virtualKeyId: "vk-1", services: ["instant_evals", "managed_models"] }),
    ]);

    await expect(
      credentials.findEntitledServices({ virtualKeyId: "vk-1", organizationId: "org-acme" }),
    ).resolves.toEqual(["instant_evals", "managed_models"]);
  });

  it("answers nothing for a key no license holds", async () => {
    const { credentials } = harness([rowFor({ virtualKeyId: "vk-1" })]);

    await expect(
      credentials.findEntitledServices({ virtualKeyId: "vk-other", organizationId: "org-acme" }),
    ).resolves.toEqual([]);
  });

  it("answers nothing for a license of another customer, or one no longer active", async () => {
    const other = harness([rowFor({ virtualKeyId: "vk-1", organizationId: "org-other" })]);
    const revoked = harness([rowFor({ virtualKeyId: "vk-1", revokedAt: NOW })]);

    await expect(
      other.credentials.findEntitledServices({
        virtualKeyId: "vk-1",
        organizationId: "org-acme",
      }),
    ).resolves.toEqual([]);
    await expect(
      revoked.credentials.findEntitledServices({
        virtualKeyId: "vk-1",
        organizationId: "org-acme",
      }),
    ).resolves.toEqual([]);
  });

  it("drops a service name this deployment does not know", async () => {
    const { credentials } = harness([
      rowFor({ virtualKeyId: "vk-1", services: ["instant_evals", "future_service"] }),
    ]);

    await expect(
      credentials.findEntitledServices({ virtualKeyId: "vk-1", organizationId: "org-acme" }),
    ).resolves.toEqual(["instant_evals"]);
  });
});
