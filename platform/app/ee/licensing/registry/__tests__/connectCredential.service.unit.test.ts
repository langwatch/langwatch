import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { licenseTokenFromKey } from "../../licenseToken";
import {
  CONNECT_CREDENTIAL_REFUSALS,
  ConnectCredentialService,
} from "../connectCredential.service";
import { LicenseRegistryService } from "../licenseRegistry.service";
import {
  InMemoryConnectManagedKeys,
  InMemoryCustomerOrganizations,
  InMemoryIssuedLicenseRepository,
} from "./registryFakes";

const NOW = new Date("2026-09-19T12:00:00.000Z");
const NEXT_YEAR = new Date("2027-09-19T12:00:00.000Z");
const OPERATOR = "user_operator";
const SYSTEM = "system:connect-license";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

function build() {
  let now = NOW;
  const repository = new InMemoryIssuedLicenseRepository(NOW);
  const organizations = new InMemoryCustomerOrganizations();
  const managedKeys = new InMemoryConnectManagedKeys();
  const registry = new LicenseRegistryService({
    repository,
    organizations,
    managedKeys,
    signingKey: () => privateKey,
    publicKey,
    encrypt: (plain) => `enc:${plain.length}`,
    now: () => now,
  });
  const credentials = new ConnectCredentialService({
    repository,
    managedKeys,
    systemActorId: SYSTEM,
    now: () => now,
  });
  return {
    repository,
    organizations,
    managedKeys,
    registry,
    credentials,
    travelTo: (date: Date) => {
      now = date;
    },
  };
}

describe("ConnectCredentialService", () => {
  let context: ReturnType<typeof build>;
  let acme: string;

  const issue = async () => {
    const { licenseKey, license } = await context.registry.issue({
      customer: { organizationId: acme },
      email: "ops@acme.test",
      planType: "ENTERPRISE",
      maxMembers: 50,
      expiresAt: NEXT_YEAR,
      operatorId: OPERATOR,
    });
    return { id: license.id, token: licenseTokenFromKey(licenseKey) as string };
  };

  beforeEach(() => {
    context = build();
    acme = context.organizations.seed("ACME");
  });

  describe("given an active license registered to a customer", () => {
    describe("when its token is resolved twice", () => {
      /** @scenario The managed key is created on first use and reused after */
      it("creates one managed key on the customer and returns it both times", async () => {
        const { token } = await issue();

        const first = await context.credentials.resolve({
          token,
          instanceId: "instance-a",
        });
        const second = await context.credentials.resolve({
          token,
          instanceId: "instance-a",
        });

        expect(first).toMatchObject({ ok: true });
        expect(second).toMatchObject({ ok: true });
        if (!first.ok || !second.ok) throw new Error("expected a resolution");
        expect(second.virtualKeyId).toBe(first.virtualKeyId);
        expect(context.managedKeys.active()).toEqual([first.virtualKeyId]);
        expect(
          context.managedKeys.keys.get(first.virtualKeyId)?.organizationId,
        ).toBe(acme);
      });
    });

    describe("when two first calls create a managed key at the same moment", () => {
      it("keeps one key and ends the other", async () => {
        const { id, token } = await issue();
        await context.repository.update(id, { instanceId: "instance-a" });

        const [first, second] = await Promise.all([
          context.credentials.resolve({ token, instanceId: "instance-a" }),
          context.credentials.resolve({ token, instanceId: "instance-a" }),
        ]);

        if (!first.ok || !second.ok) throw new Error("expected a resolution");
        expect(second.virtualKeyId).toBe(first.virtualKeyId);
        expect(context.managedKeys.keys.size).toBe(2);
        expect(context.managedKeys.active()).toEqual([first.virtualKeyId]);
      });
    });

    describe("when the customer holds two licenses for two installs", () => {
      /** @scenario Each license gets its own managed key */
      it("resolves each to its own key, both on the one customer organization", async () => {
        const one = await issue();
        const two = await issue();

        const first = await context.credentials.resolve({
          token: one.token,
          instanceId: "instance-a",
        });
        const second = await context.credentials.resolve({
          token: two.token,
          instanceId: "instance-b",
        });

        if (!first.ok || !second.ok) throw new Error("expected a resolution");
        expect(first.virtualKeyId).not.toBe(second.virtualKeyId);
        expect(
          [first, second].map(
            (r) => context.managedKeys.keys.get(r.virtualKeyId)?.organizationId,
          ),
        ).toEqual([acme, acme]);
      });
    });

    describe("when no instance is bound and an install presents the token", () => {
      /** @scenario The first instance to present a license is bound to it */
      it("binds the license to that instance", async () => {
        const { id, token } = await issue();

        await context.credentials.resolve({ token, instanceId: "instance-a" });

        expect(await context.repository.findById(id)).toMatchObject({
          instanceId: "instance-a",
          instanceBoundAt: NOW,
        });
      });
    });

    describe("when two instances present the token at the same moment", () => {
      /** @scenario Two instances racing to bind leave exactly one bound */
      it("binds exactly one and refuses the other as the wrong instance", async () => {
        const { id, token } = await issue();

        const results = await Promise.all([
          context.credentials.resolve({ token, instanceId: "instance-a" }),
          context.credentials.resolve({ token, instanceId: "instance-b" }),
        ]);

        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.filter((r) => !r.ok)).toEqual([
          { ok: false, code: "connect_wrong_instance" },
        ]);
        const winner = results.find((r) => r.ok);
        expect((await context.repository.findById(id))?.instanceId).toBe(
          winner?.ok ? winner.license.instanceId : null,
        );
      });
    });

    describe("when it is bound and another instance presents the same token", () => {
      /** @scenario A license token replayed from another instance is refused */
      it("refuses with connect_wrong_instance and leaves the binding alone", async () => {
        const { id, token } = await issue();
        await context.credentials.resolve({ token, instanceId: "instance-a" });

        const replay = await context.credentials.resolve({
          token,
          instanceId: "instance-b",
        });

        expect(replay).toEqual({ ok: false, code: "connect_wrong_instance" });
        expect((await context.repository.findById(id))?.instanceId).toBe(
          "instance-a",
        );
      });
    });

    describe("when the token arrives without a usable instance id", () => {
      /** @scenario A license token with no instance id is refused */
      it.each([
        ["absent", undefined],
        ["blank", "   "],
        ["longer than an id", "x".repeat(129)],
        ["carrying characters no id has", "instance a\n"],
      ])("refuses with connect_instance_required when it is %s", async (_label, instanceId) => {
        const { token } = await issue();

        expect(
          await context.credentials.resolve({ token, instanceId }),
        ).toEqual({ ok: false, code: "connect_instance_required" });
      });
    });

    describe("when the license has been revoked", () => {
      /** @scenario A revoked license is refused */
      it("refuses with connect_license_revoked", async () => {
        const { id, token } = await issue();
        await context.registry.revoke({
          id,
          operatorId: OPERATOR,
          reason: "leaked",
        });

        expect(
          await context.credentials.resolve({
            token,
            instanceId: "instance-a",
          }),
        ).toEqual({ ok: false, code: "connect_license_revoked" });
      });
    });

    describe("when the license term has ended", () => {
      /** @scenario An expired license is refused */
      it("refuses with connect_license_expired", async () => {
        const { token } = await issue();
        context.travelTo(new Date(NEXT_YEAR.getTime() + 1));

        expect(
          await context.credentials.resolve({
            token,
            instanceId: "instance-a",
          }),
        ).toEqual({ ok: false, code: "connect_license_expired" });
      });
    });
  });

  describe("given a token that is not in the registry", () => {
    /** @scenario An unregistered license is refused */
    it("refuses with connect_license_not_registered", async () => {
      expect(
        await context.credentials.resolve({
          token: `lwl_${"a".repeat(64)}`,
          instanceId: "instance-a",
        }),
      ).toEqual({ ok: false, code: "connect_license_not_registered" });
    });
  });

  describe("given a license recorded by a purchase and linked to no customer", () => {
    /** @scenario An unlinked license resolves to nothing */
    it("refuses exactly like a license that was never recorded, and creates no key", async () => {
      const { licenseKey } = await context.registry.issue({
        customer: { organizationId: acme },
        email: "ops@acme.test",
        planType: "ENTERPRISE",
        maxMembers: 50,
        expiresAt: NEXT_YEAR,
        operatorId: OPERATOR,
      });
      const row = context.repository.rows[0];
      if (!row) throw new Error("expected the issued row");
      row.organizationId = null;

      expect(
        await context.credentials.resolve({
          token: licenseTokenFromKey(licenseKey) as string,
          instanceId: "instance-a",
        }),
      ).toEqual({ ok: false, code: "connect_license_not_registered" });
      expect(context.managedKeys.keys.size).toBe(0);
    });
  });

  describe("given a token with the license prefix that is not 64 hex characters", () => {
    /** @scenario A malformed license token is refused before any lookup */
    it("refuses without querying the registry", async () => {
      const lookup = vi.spyOn(context.repository, "findByTokenHash");

      expect(
        await context.credentials.resolve({
          token: "lwl_not-a-hash",
          instanceId: "instance-a",
        }),
      ).toEqual({ ok: false, code: "connect_license_token_malformed" });
      expect(lookup).not.toHaveBeenCalled();
    });
  });

  describe("given every refusal the gateway can be handed", () => {
    it("says nothing about the customer, the seats or the term", () => {
      for (const { message } of Object.values(CONNECT_CREDENTIAL_REFUSALS)) {
        expect(message).not.toMatch(/acme|seat|member|\d{4}/i);
      }
    });
  });
});
