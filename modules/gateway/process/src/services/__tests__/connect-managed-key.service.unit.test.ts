import type { GatewayManagedKeyProvisionedEventData } from "@langwatch/gateway-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  ConnectManagedKeyService,
  type ConnectManagedKeyHome,
  type ConnectManagedKeyWrites,
} from "../connect-managed-key.service.ts";

type CreateCall = Parameters<ConnectManagedKeyWrites["create"]>[0];

class RecordingWrites implements ConnectManagedKeyWrites {
  readonly created: CreateCall[] = [];
  readonly revoked: { id: string; organizationId: string; actorUserId: string }[] = [];
  readonly invalidated: { id: string; organizationId: string }[] = [];
  readonly servicesSet: { id: string; organizationId: string; services: readonly string[] }[] = [];
  readonly licensesSet: Parameters<ConnectManagedKeyWrites["setLicenseFactsInternal"]>[0][] = [];

  async create(input: CreateCall): Promise<{ virtualKey: { id: string } }> {
    this.created.push(input);
    return { virtualKey: { id: `vk-${this.created.length}` } };
  }

  async revokeManagedInternal(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<void> {
    this.revoked.push(input);
  }

  async invalidateManagedInternal(input: { id: string; organizationId: string }): Promise<void> {
    this.invalidated.push(input);
  }

  async setConnectServicesInternal(input: {
    id: string;
    organizationId: string;
    services: readonly string[];
  }): Promise<void> {
    this.servicesSet.push(input);
  }

  async setLicenseFactsInternal(
    input: Parameters<ConnectManagedKeyWrites["setLicenseFactsInternal"]>[0],
  ): Promise<void> {
    this.licensesSet.push(input);
  }

  existing: string[] = [];

  async findConnectKeyIdsForLicenseInternal(): Promise<string[]> {
    return this.existing;
  }
}

const home: ConnectManagedKeyHome = {
  ensureInternal: async () => ({ id: "project-governance" }),
};

function harness(): { writes: RecordingWrites; service: ConnectManagedKeyService } {
  const writes = new RecordingWrites();
  return { writes, service: ConnectManagedKeyService.create({ virtualKeys: writes, home }) };
}

describe("the managed key of a self-hosted license", () => {
  it("mints a key the customer cannot see, scoped to the whole organization", async () => {
    const { writes, service } = harness();

    const key = await service.provision({
      organizationId: "org-1",
      licenseId: "lic-1",
      actorUserId: "system",
    });

    expect(key).toEqual({ id: "vk-1" });
    expect(writes.created[0]).toMatchObject({
      organizationId: "org-1",
      purpose: "CONNECT",
      principalUserId: null,
      scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
    });
  });

  it("spends on the organization's hidden governance project", async () => {
    const { writes, service } = harness();

    await service.provision({
      organizationId: "org-1",
      licenseId: "lic-1",
      actorUserId: "system",
    });

    expect(writes.created[0]?.traceProjectId).toBe("project-governance");
  });

  it("names the license the key belongs to", async () => {
    const { writes, service } = harness();

    await service.provision({
      organizationId: "org-1",
      licenseId: "lic-42",
      actorUserId: "system",
    });

    expect(writes.created[0]?.name).toBe("Connect lic-42");
  });

  it("ends the key through the internal door, attributing the operator", async () => {
    const { writes, service } = harness();

    await service.retire({ virtualKeyId: "vk-1", organizationId: "org-1", actorId: "op-1" });

    expect(writes.revoked).toEqual([{ id: "vk-1", organizationId: "org-1", actorUserId: "op-1" }]);
  });

  it("invalidates without touching the key, so a rebound install is noticed", async () => {
    const { writes, service } = harness();

    await service.invalidate({ virtualKeyId: "vk-1", organizationId: "org-1" });

    expect(writes.invalidated).toEqual([{ id: "vk-1", organizationId: "org-1" }]);
    expect(writes.revoked).toEqual([]);
  });

  it("records the services the license grants on the key itself", async () => {
    const { writes, service } = harness();

    await service.setConnectServices({
      virtualKeyId: "vk-1",
      organizationId: "org-1",
      services: ["managed_models"],
    });

    expect(writes.servicesSet).toEqual([
      { id: "vk-1", organizationId: "org-1", services: ["managed_models"] },
    ]);
  });

  it("records the license the key serves, so the gateway resolves its token alone", async () => {
    const { writes, service } = harness();
    const expiresAt = Temporal.Instant.from("2027-01-01T00:00:00Z");

    await service.setLicense({
      virtualKeyId: "vk-1",
      organizationId: "org-1",
      tokenHash: "hash-1",
      instanceId: "instance-1",
      expiresAt,
    });

    expect(writes.licensesSet).toEqual([
      {
        id: "vk-1",
        organizationId: "org-1",
        tokenHash: "hash-1",
        instanceId: "instance-1",
        expiresAt,
      },
    ]);
  });
});

const ISSUED = {
  tenantId: "org-1",
  occurredAt: Date.UTC(2026, 9, 9),
  organizationId: "org-1",
  licenseId: "lic-1",
  issuedLicenseId: "issued-1",
  instanceId: "instance-1",
  tokenHash: "hash-1",
  expiresAt: Date.UTC(2027, 9, 9),
  services: ["llm"],
};

function provisioning({ existing }: { existing: string[] }) {
  const { writes, service } = harness();
  writes.existing = existing;
  const sent: { data: GatewayManagedKeyProvisionedEventData; writesBefore: number }[] = [];
  service.connect({
    recordManagedKeyProvisioned: {
      send: async (data) =>
        void sent.push({
          data,
          writesBefore: writes.servicesSet.length + writes.licensesSet.length,
        }),
    },
  });
  return { writes, service, sent };
}

describe("given licensing records a connect credential issued", () => {
  describe("when the licence has no managed key yet", () => {
    /** @scenario "Gateway provisions one managed key per licence from licensing's issued fact" */
    it("mints one, writes its services and licence, and only then records it provisioned", async () => {
      const { writes, service, sent } = provisioning({ existing: [] });

      await service.provisionForLicense(ISSUED);

      expect(writes.created).toHaveLength(1);
      expect(writes.created[0]).toMatchObject({
        name: "Connect lic-1",
        purpose: "CONNECT",
        actorUserId: "system:connect-license",
      });
      expect(writes.servicesSet).toEqual([
        { id: "vk-1", organizationId: "org-1", services: ["llm"] },
      ]);
      expect(writes.licensesSet[0]).toMatchObject({
        id: "vk-1",
        organizationId: "org-1",
        licenseId: "lic-1",
        tokenHash: "hash-1",
        instanceId: "instance-1",
      });
      expect(writes.licensesSet[0]?.expiresAt?.epochMilliseconds).toBe(ISSUED.expiresAt);
      expect(sent).toEqual([
        {
          writesBefore: 2,
          data: {
            tenantId: "org-1",
            occurredAt: expect.any(Number),
            organizationId: "org-1",
            licenseId: "lic-1",
            issuedLicenseId: "issued-1",
            virtualKeyId: "vk-1",
          },
        },
      ]);
    });
  });

  describe("when the licence already holds a key, as on a repeated fact", () => {
    /** @scenario "Gateway provisions one managed key per licence from licensing's issued fact" */
    it("mints none and records the oldest key it found", async () => {
      const { writes, service, sent } = provisioning({ existing: ["vk-existing", "vk-later"] });

      await service.provisionForLicense(ISSUED);

      expect(writes.created).toEqual([]);
      expect(writes.licensesSet[0]).toMatchObject({ id: "vk-existing", licenseId: "lic-1" });
      expect(sent.map(({ data }) => data.virtualKeyId)).toEqual(["vk-existing"]);
    });
  });
});
