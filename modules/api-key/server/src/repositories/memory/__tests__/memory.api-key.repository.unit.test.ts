import { describe, expect, it } from "vitest";
import { AGENT_SANDBOX_API_KEY_NAME, HIDDEN_SYSTEM_KEY_NAMES } from "@langwatch/api-key-contract";
import { fromDate } from "@langwatch/time";
import type { ApiKeyCreateRecord } from "../../api-key.repository.ts";
import { MemoryApiKeyDatabase } from "../memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../memory.api-key.repository.ts";

const ORGANIZATION = "org_1";

function repository(): { repository: MemoryApiKeyRepository; memory: MemoryApiKeyDatabase } {
  const memory = MemoryApiKeyDatabase.create();

  return { repository: MemoryApiKeyRepository.create({ memory }), memory };
}

function record(overrides: Partial<ApiKeyCreateRecord> = {}): ApiKeyCreateRecord {
  return {
    name: "Deploy key",
    description: null,
    lookupId: `lookup_${Math.random().toString(36).slice(2)}`,
    hashedSecret: "hashed",
    permissionMode: "all",
    userId: null,
    createdByUserId: null,
    organizationId: ORGANIZATION,
    expiresAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    startsDisabled: false,
    roleBindings: [],
    ...overrides,
  };
}

describe("given the memory API-key repository", () => {
  describe("when a key is created", () => {
    it("reads it back live, with no bindings, as the Prisma create does", async () => {
      const { repository: keys } = repository();

      const created = await keys.create(record({ name: "Personal key", userId: "user_1" }));

      expect(created.revokedAt).toBeNull();
      expect(created.roleBindings).toEqual([]);
      expect(await keys.findById({ id: created.id })).toMatchObject({ name: "Personal key" });
    });

    it("stores a key that starts disabled as already revoked", async () => {
      const { repository: keys } = repository();

      const created = await keys.create(record({ startsDisabled: true }));

      expect(created.revokedAt).not.toBeNull();
    });
  });

  describe("when a key is looked up by its lookup id", () => {
    it("answers nothing for a key whose owner is deactivated", async () => {
      const { repository: keys, memory } = repository();
      const created = await keys.create(record({ userId: "user_1", lookupId: "lookup_1" }));
      memory.deactivateUser("user_1");

      expect(await keys.findByLookupId({ lookupId: created.lookupId })).toBeNull();
    });

    it("answers the key of an active owner", async () => {
      const { repository: keys } = repository();
      await keys.create(record({ userId: "user_1", lookupId: "lookup_2" }));

      expect(await keys.findByLookupId({ lookupId: "lookup_2" })).not.toBeNull();
    });
  });

  describe("when an organization's keys are listed", () => {
    it("hides the system-managed names and the revoked rows", async () => {
      const { repository: keys } = repository();
      await keys.create(record({ name: HIDDEN_SYSTEM_KEY_NAMES[0] ?? AGENT_SANDBOX_API_KEY_NAME }));
      const revoked = await keys.create(record({ name: "Retired" }));
      await keys.revoke({ id: revoked.id, cause: "user" });
      await keys.create(record({ name: "Live" }));

      const listed = await keys.listForOrganization({ organizationId: ORGANIZATION });

      expect(listed.map((key) => key.name)).toEqual(["Live"]);
    });

    it("gives a member their own keys and the ownerless non-ingestion ones", async () => {
      const { repository: keys } = repository();
      await keys.create(record({ name: "Mine", userId: "user_1" }));
      await keys.create(record({ name: "Somebody else", userId: "user_2" }));
      await keys.create(record({ name: "Shared" }));
      await keys.create(record({ name: "Ingest", ingestSourceType: "cli" }));

      const listed = await keys.listForUser({ organizationId: ORGANIZATION, userId: "user_1" });

      expect(listed.map((key) => key.name).sort()).toEqual(["Mine", "Shared"]);
    });
  });

  describe("when a key is revoked twice", () => {
    it("keeps the first cause", async () => {
      const { repository: keys } = repository();
      const created = await keys.create(record());

      await keys.revoke({ id: created.id, cause: "user" });
      const second = await keys.revoke({ id: created.id, cause: "cap" });

      expect(second.revocationCause).toBe("user");
    });
  });

  describe("when the expired keys of one reserved name are swept", () => {
    it("revokes only the elapsed ones and never a key without an expiry", async () => {
      const { repository: keys } = repository();
      const past = new Date(Date.now() - 60_000);
      const future = new Date(Date.now() + 60_000);
      const elapsed = await keys.create(
        record({ name: AGENT_SANDBOX_API_KEY_NAME, expiresAt: fromDate(past) }),
      );
      const live = await keys.create(
        record({ name: AGENT_SANDBOX_API_KEY_NAME, expiresAt: fromDate(future) }),
      );
      const endless = await keys.create(record({ name: AGENT_SANDBOX_API_KEY_NAME }));

      const swept = await keys.revokeExpiredByName({
        name: AGENT_SANDBOX_API_KEY_NAME,
        now: fromDate(new Date()),
      });

      expect(swept).toBe(1);
      expect((await keys.findById({ id: elapsed.id }))?.revokedAt).not.toBeNull();
      expect((await keys.findById({ id: live.id }))?.revokedAt).toBeNull();
      expect((await keys.findById({ id: endless.id }))?.revokedAt).toBeNull();
    });
  });
});
