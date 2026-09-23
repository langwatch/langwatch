/**
 * @vitest-environment node
 * Who an asserted address and a connection subject belong to. Both halves are
 * load-bearing: the address keeps a colleague's out of a connection under
 * setup, the membership stops a registrant who has left.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryIdentityRepositories } from "../../repositories/memory/memory.identity.repositories.ts";
import { MemoryIdentityStore } from "../../repositories/memory/memory.identity.store.ts";
import { SsoRegistrantReadsService } from "../sso-registrant-reads.service.ts";

const ORG = "org_acme";
const CONNECTION = "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m";

function scenario({ member = true }: { member?: boolean } = {}) {
  const store = MemoryIdentityStore.create();
  const isMember = vi.fn().mockResolvedValue(member);

  return {
    store,
    isMember,
    service: SsoRegistrantReadsService.create({
      registrants: MemoryIdentityRepositories.over(store).ssoRegistrants,
      organizations: createApiFixture<OrganizationApi>({ isMember }),
    }),
  };
}

function seedUser(store: MemoryIdentityStore, userId: string, email: string | null): void {
  store.users.set(userId, {
    id: userId,
    email,
    emailVerified: email !== null,
    createdAtMs: 1_700_000_000_000,
    userHashKey: null,
    payload: {},
  });
}

function seedIdentifier(
  store: MemoryIdentityStore,
  identifierId: string,
  over: { userId: string; value: string; state: "VERIFIED" | "PRIMARY" | "DETACHED" | "ATTACHED" },
): void {
  store.identifiers.set(identifierId, {
    identifierId,
    provider: "credential",
    domain: over.value.split("@")[1] ?? null,
    identifierHash: null,
    accountId: null,
    providerId: null,
    issuer: null,
    providerAccountId: null,
    connectionId: null,
    verifiedAtMs: over.state === "DETACHED" ? null : 1_700_000_000_000,
    attachedAtMs: 1_700_000_000_000,
    detachedAtMs: over.state === "DETACHED" ? 1_700_000_000_001 : null,
    ...over,
  });
}

describe("given an address asserted against a named person", () => {
  describe("when the address is only the legacy copy on their user row", () => {
    it("is theirs", async () => {
      const { store, service } = scenario();
      seedUser(store, "user_ana", "Ana@Acme.com");

      await expect(
        service.findRegistrantAtAddress({
          organizationId: ORG,
          userId: "user_ana",
          email: "ana@acme.com",
        }),
      ).resolves.toBe(true);
    });
  });

  describe("when the address is an identifier they still hold", () => {
    it("is theirs", async () => {
      const { store, service } = scenario();
      seedUser(store, "user_ana", null);
      seedIdentifier(store, "id_1", {
        userId: "user_ana",
        value: "ana@acme.com",
        state: "VERIFIED",
      });

      await expect(
        service.findRegistrantAtAddress({
          organizationId: ORG,
          userId: "user_ana",
          email: "ana@acme.com",
        }),
      ).resolves.toBe(true);
    });
  });

  describe("when the address is one they proved once and have since given up", () => {
    it("is not theirs: a tombstone must not keep a connection dialable", async () => {
      const { store, service } = scenario();
      seedUser(store, "user_ana", null);
      seedIdentifier(store, "id_1", {
        userId: "user_ana",
        value: "ana@acme.com",
        state: "DETACHED",
      });

      await expect(
        service.findRegistrantAtAddress({
          organizationId: ORG,
          userId: "user_ana",
          email: "ana@acme.com",
        }),
      ).resolves.toBe(false);
    });
  });

  describe("when the person has left the organization", () => {
    it("is refused without the address ever being read", async () => {
      const { store, service, isMember } = scenario({ member: false });
      seedUser(store, "user_ana", "ana@acme.com");

      await expect(
        service.findRegistrantAtAddress({
          organizationId: ORG,
          userId: "user_ana",
          email: "ana@acme.com",
        }),
      ).resolves.toBe(false);
      expect(isMember).toHaveBeenCalledExactlyOnceWith({
        organizationId: ORG,
        userId: "user_ana",
      });
    });
  });
});

describe("given a connection subject asserted after its domain's proof lapsed", () => {
  describe("when the subject is bound to a current member at that address", () => {
    it("is one this connection already carried", async () => {
      const { store, service } = scenario();
      seedUser(store, "user_ana", "ana@acme.com");
      store.accounts.set("user_ana", [
        {
          id: "acc_1",
          provider: CONNECTION,
          issuer: null,
          providerAccountId: "subject-1",
          createdAtMs: 1_700_000_000_000,
        },
      ]);

      await expect(
        service.findBoundMemberIdentity({
          organizationId: ORG,
          connectionId: CONNECTION,
          accountId: "subject-1",
          email: "ana@acme.com",
        }),
      ).resolves.toBe(true);
    });
  });

  describe("when the asserted address is somebody else's", () => {
    it("is refused, though the subject itself is bound", async () => {
      const { store, service } = scenario();
      seedUser(store, "user_ana", "ana@acme.com");
      store.accounts.set("user_ana", [
        {
          id: "acc_1",
          provider: CONNECTION,
          issuer: null,
          providerAccountId: "subject-1",
          createdAtMs: 1_700_000_000_000,
        },
      ]);

      await expect(
        service.findBoundMemberIdentity({
          organizationId: ORG,
          connectionId: CONNECTION,
          accountId: "subject-1",
          email: "mallory@acme.com",
        }),
      ).resolves.toBe(false);
    });
  });

  describe("when nothing carries the subject", () => {
    it("is refused without asking who is a member", async () => {
      const { service, isMember } = scenario();

      await expect(
        service.findBoundMemberIdentity({
          organizationId: ORG,
          connectionId: CONNECTION,
          accountId: "subject-1",
          email: "ana@acme.com",
        }),
      ).resolves.toBe(false);
      expect(isMember).not.toHaveBeenCalled();
    });
  });
});
