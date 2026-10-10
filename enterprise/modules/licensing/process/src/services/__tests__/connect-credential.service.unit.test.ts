import { NodeLicenseCryptographyService } from "@langwatch/enterprise-license-signing";
import { registryHashForToken } from "@langwatch/gateway-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { TEST_PUBLIC_KEY } from "../../__tests__/fixtures/license-keys.fixture.ts";
import type { IssuedLicenseRecord } from "../../repositories/issued-license.repository.ts";
import { MemoryIssuedLicenseRepository } from "../../repositories/memory/memory.issued-license.repository.ts";
import { ConnectCredentialService } from "../connect-credential.service.ts";
import type { ConnectManagedKeys } from "../license-registry.service.ts";
import { LicenseSyncService } from "../license-sync.service.ts";

const NOW: Instant = Temporal.Instant.from("2026-01-01T00:00:00.000Z");
const TOKEN = `lwl_${"a".repeat(64)}`;
const OTHER_TOKEN = `lwl_${"b".repeat(64)}`;
const TOKEN_HASH = await registryHashForToken(TOKEN);
const OTHER_TOKEN_HASH = await registryHashForToken(OTHER_TOKEN);

const cryptography = NodeLicenseCryptographyService.create({ publicKey: TEST_PUBLIC_KEY });

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
    seatsRaisedFrom: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

class RecordingManagedKeys {
  readonly retired: string[] = [];
  readonly published: { virtualKeyId: string; services: string[] }[] = [];
  readonly licensed: Parameters<ConnectManagedKeys["setLicense"]>[0][] = [];

  readonly issued: Parameters<ConnectManagedKeys["issue"]>[0][] = [];

  async issue(fact: Parameters<ConnectManagedKeys["issue"]>[0]): Promise<void> {
    this.issued.push(fact);
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

const PROVISIONED = {
  issuedLicenseId: "license-1",
  organizationId: "org-acme",
  virtualKeyId: "vk-1",
};

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
  /** @scenario An unlinked license resolves to nothing */
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
  /** @scenario "Licensing records a licence's connect credential issued as a fact for gateway to provision" */
  it("binds the first install that presents it and asks gateway for its managed key", async () => {
    const { credentials, repository, managedKeys } = harness([rowFor()]);

    const resolution = await credentials.resolve({ token: TOKEN, instanceId: "install-1" });

    expect(resolution).toEqual({ ok: false, code: "connect_credential_pending" });
    const row = await repository.findById("license-1");
    expect(row?.instanceId).toBe("install-1");
    expect(row?.instanceBoundAt).toEqual(NOW);
    expect(managedKeys.issued).toEqual([
      {
        organizationId: "org-acme",
        licenseId: "lic-1",
        issuedLicenseId: "license-1",
        instanceId: "install-1",
        tokenHash: TOKEN_HASH,
        expiresAt: row?.expiresAt,
        services: ["instant_evals"],
      },
    ]);
  });

  /** @scenario "The managed key is created on first use and reused after" */
  it("answers pending until gateway's key attaches, then reuses that key on every call", async () => {
    const { credentials, managedKeys } = harness([rowFor()]);

    const first = await credentials.resolve({ token: TOKEN, instanceId: "install-1" });
    await credentials.attachProvisioned(PROVISIONED);
    const second = await credentials.resolve({ token: TOKEN, instanceId: "install-1" });
    const third = await credentials.resolve({ token: TOKEN, instanceId: "install-1" });

    expect(first).toEqual({ ok: false, code: "connect_credential_pending" });
    expect(second.ok && second.virtualKeyId).toBe("vk-1");
    expect(third.ok && third.virtualKeyId).toBe("vk-1");
    expect(managedKeys.issued).toHaveLength(1);
  });

  it("writes the facts the gateway resolves the token by onto the managed key, every time", async () => {
    const { credentials, managedKeys, repository } = harness([rowFor()]);

    await credentials.resolve({ token: TOKEN, instanceId: "install-1" });
    expect(managedKeys.licensed).toEqual([]);
    await credentials.attachProvisioned(PROVISIONED);
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
    expect(managedKeys.issued).toEqual([]);
  });

  it("records no issued fact for a bound license presented by another install", async () => {
    const { credentials, managedKeys } = harness([
      rowFor({ instanceId: "install-1", instanceBoundAt: NOW }),
    ]);

    await credentials.resolve({ token: TOKEN, instanceId: "install-2" });

    expect(managedKeys.issued).toEqual([]);
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

describe("attaching the key gateway provisioned", () => {
  const bound = () => rowFor({ instanceId: "install-1", instanceBoundAt: NOW });

  /** @scenario "Licensing attaches gateway's provisioned key once, however often the fact arrives" */
  it("does nothing when the same fact arrives again", async () => {
    const { credentials, repository, managedKeys } = harness([bound()]);

    await credentials.attachProvisioned(PROVISIONED);
    await credentials.attachProvisioned(PROVISIONED);

    expect((await repository.findById("license-1"))?.virtualKeyId).toBe("vk-1");
    expect(managedKeys.retired).toEqual([]);
  });

  /** @scenario A managed key that fails to attach is ended */
  it("ends only the new key when the licence already holds another", async () => {
    const { credentials, repository, managedKeys } = harness([
      rowFor({ instanceId: "install-1", instanceBoundAt: NOW, virtualKeyId: "vk-attached" }),
    ]);

    await credentials.attachProvisioned(PROVISIONED);

    expect(managedKeys.retired).toEqual(["vk-1"]);
    expect((await repository.findById("license-1"))?.virtualKeyId).toBe("vk-attached");
  });

  /** @scenario A license that stops being active mid-call issues no credential */
  it("ends the key of a licence revoked before it attached, and refuses by the new state", async () => {
    const { credentials, repository, managedKeys } = harness([rowFor()]);

    await credentials.resolve({ token: TOKEN, instanceId: "install-1" });
    await repository.update("license-1", { revokedAt: NOW });
    await credentials.attachProvisioned(PROVISIONED);

    expect(managedKeys.retired).toEqual(["vk-1"]);
    expect((await repository.findById("license-1"))?.virtualKeyId).toBeNull();
    await expect(credentials.resolve({ token: TOKEN, instanceId: "install-1" })).resolves.toEqual({
      ok: false,
      code: "connect_license_revoked",
    });
  });

  it("ends a key whose fact names another customer, and attaches nothing", async () => {
    const { credentials, repository, managedKeys } = harness([bound()]);

    await credentials.attachProvisioned({ ...PROVISIONED, organizationId: "org-other" });

    expect(managedKeys.retired).toEqual(["vk-1"]);
    expect((await repository.findById("license-1"))?.virtualKeyId).toBeNull();
  });

  it("ends a key for a licence no install has bound", async () => {
    const { credentials, managedKeys } = harness([rowFor()]);

    await credentials.attachProvisioned(PROVISIONED);

    expect(managedKeys.retired).toEqual(["vk-1"]);
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
      systemActorId: "system",
      now: () => NOW,
    });
    /** The door's check, then the sync, as the connect host runs them. */
    const syncAs = async ({ token, body }: { token: string; body: unknown }) =>
      sync.recordSync({
        caller: await sync.verify({ bearer: token, instanceId: "install-1" }),
        body,
      });
    return { repository, managedKeys, sync, syncAs };
  }

  const body = { version: "1.2.3", seats: { members: 12, liteMembers: 3 } };

  /** @scenario "The last report replaces the one before it" */
  it("records the last report and answers the entitled services", async () => {
    const { syncAs, repository } = syncHarness([rowFor({ virtualKeyId: "vk-1" })]);

    const result = await syncAs({ token: TOKEN, body });

    expect(result).toEqual({ ok: true, services: ["instant_evals"] });
    const row = await repository.findById("license-1");
    expect(row?.lastSyncAt).toEqual(NOW);
    expect(row?.lastSyncVersion).toBe("1.2.3");
    expect(row?.reportedMembers).toBe(12);
    expect(row?.reportedMembersLite).toBe(3);
  });

  it("tells the gateway the services the license grants on every sync", async () => {
    const { syncAs, managedKeys } = syncHarness([
      rowFor({ services: ["managed_models"], virtualKeyId: "vk-1" }),
    ]);

    await syncAs({ token: TOKEN, body });

    expect(managedKeys.published).toEqual([{ virtualKeyId: "vk-1", services: ["managed_models"] }]);
  });

  it("throws pending by its code at the door while the licence has no managed key", async () => {
    const { sync } = syncHarness([rowFor()]);

    await expect(sync.verify({ bearer: TOKEN, instanceId: "install-1" })).rejects.toMatchObject({
      code: "connect_credential_pending",
      httpStatus: 503,
    });
  });

  it("tells the gateway a license granting nothing serves nothing", async () => {
    const { syncAs, managedKeys } = syncHarness([
      rowFor({ services: [], instanceId: "install-1", instanceBoundAt: NOW, virtualKeyId: "vk-9" }),
    ]);

    await syncAs({ token: TOKEN, body });

    expect(managedKeys.published).toEqual([{ virtualKeyId: "vk-9", services: [] }]);
  });

  /** @scenario "A sync with a malformed payload is refused" */
  it("refuses a payload that carries anything but the version and the seats", async () => {
    const { syncAs, repository } = syncHarness([rowFor({ virtualKeyId: "vk-1" })]);

    const result = await syncAs({ token: TOKEN, body: { ...body, organizationName: "ACME" } });

    expect(result).toEqual({ ok: false, code: "validation_error" });
    expect((await repository.findById("license-1"))?.lastSyncAt).toBeNull();
  });

  /** @scenario "Sync is rate limited per license" */
  it("refuses a license that has synced too many times today", async () => {
    const { syncAs } = syncHarness([rowFor({ virtualKeyId: "vk-1" })], { allow: false });

    await expect(syncAs({ token: TOKEN, body })).resolves.toEqual({
      ok: false,
      code: "rate_limited",
    });
  });

  /** @scenario "A sync from an unregistered, revoked or wrong-instance license is refused" */
  it("throws the credential's own refusal at the door", async () => {
    const { sync } = syncHarness([rowFor({ revokedAt: NOW })]);

    await expect(sync.verify({ bearer: TOKEN, instanceId: "install-1" })).rejects.toMatchObject({
      code: "connect_license_revoked",
      httpStatus: 403,
    });
  });

  /** @scenario "The connect host's door refuses a malformed licence token before the body" */
  /** @scenario "The connect host's door refuses a licence token presented without an instance id" */
  it("reads the bearer header at the door, and throws a refusal by its code", async () => {
    const { sync } = syncHarness([rowFor({ virtualKeyId: "vk-1" })]);

    const caller = await sync.verify({ bearer: TOKEN, instanceId: "install-1" });
    expect(caller).toEqual({
      licenseRowId: "license-1",
      organizationId: caller.organizationId,
      instanceId: "install-1",
      virtualKeyId: "vk-1",
    });
    await expect(sync.answer({ caller, body })).resolves.toEqual({ services: ["instant_evals"] });
    await expect(sync.verify({ bearer: null, instanceId: "install-1" })).rejects.toMatchObject({
      code: "connect_license_token_malformed",
      httpStatus: 401,
    });
    await expect(sync.verify({ bearer: TOKEN, instanceId: undefined })).rejects.toMatchObject({
      code: "connect_instance_required",
      httpStatus: 400,
    });
  });

  /** @scenario "The replaced license is retired once the new one is in use" */
  /** @scenario A reissued license is held encrypted only until it is delivered */
  it("delivers a reissued license until the install presents it", async () => {
    const replacement = rowFor({
      id: "license-2",
      licenseId: "lic-2",
      tokenHash: OTHER_TOKEN_HASH,
      replacesId: "license-1",
      pendingDeliveryLicense: "new-license-key",
      instanceId: "install-1",
      instanceBoundAt: NOW,
      virtualKeyId: "vk-new",
    });
    const { syncAs, repository, managedKeys } = syncHarness([
      rowFor({ instanceId: "install-1", instanceBoundAt: NOW, virtualKeyId: "vk-old" }),
      replacement,
    ]);

    const held = await syncAs({ token: TOKEN, body });
    expect(held).toEqual({ ok: true, services: ["instant_evals"], license: "new-license-key" });

    // Presenting the new token is what retires the license it replaced.
    const applied = await syncAs({ token: OTHER_TOKEN, body });
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
