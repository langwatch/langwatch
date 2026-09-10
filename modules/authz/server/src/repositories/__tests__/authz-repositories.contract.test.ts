/**
 * @vitest-environment node
 * The contract every authz backend answers the same way, stated once and run
 * against each backend the package can reach. The memory tier runs it always;
 * a Postgres backend joins the table as a second row when this package
 * declares that datastore.
 */
import { describe, expect, it } from "vitest";
import type { AuthzRepositories } from "../authz.repositories.ts";
import { AuthzMemoryStore } from "../memory/authz-memory.store.ts";
import { MemoryAuthzBindingRepository } from "../memory/memory.authz-binding.repository.ts";
import { MemoryAuthzCutoverRepository } from "../memory/memory.authz-cutover.repository.ts";
import { MemoryAuthzEpochRepository } from "../memory/memory.authz-epoch.repository.ts";

const ORGANIZATION_ID = "org_contract";
const USER_ID = "user_contract";

type Backend = Readonly<{
  name: string;
  create: () => AuthzRepositories & { store: AuthzMemoryStore };
}>;

const backends: readonly Backend[] = [
  {
    name: "memory",
    create: () => {
      const memory = AuthzMemoryStore.create();

      return {
        store: memory,
        bindings: MemoryAuthzBindingRepository.create({ memory }),
        cutover: MemoryAuthzCutoverRepository.create({ memory }),
      };
    },
  },
];

describe.each(backends)("given the $name authz backend", (backend) => {
  describe("when no row has been written", () => {
    it("reads no cutover for an organization", async () => {
      const { cutover } = backend.create();

      await expect(cutover.findCutover({ organizationId: ORGANIZATION_ID })).resolves.toBeNull();
    });

    it("reads no bindings for a user", async () => {
      const { bindings } = backend.create();

      await expect(
        bindings.hasBindingsForUser({ organizationId: ORGANIZATION_ID, userId: USER_ID }),
      ).resolves.toBe(false);
    });

    it("finds no binding by id", async () => {
      const { bindings } = backend.create();

      await expect(
        bindings.tryFindBinding({ organizationId: ORGANIZATION_ID, bindingId: "rb_missing" }),
      ).resolves.toBeNull();
    });
  });

  describe("when a finalized cutover has been written", () => {
    it("reads the status and the business time back", async () => {
      const repositories = backend.create();
      const occurredAt = new Date("2026-08-18T09:00:00.000Z");
      repositories.store.cutovers.set(ORGANIZATION_ID, {
        organizationId: ORGANIZATION_ID,
        status: "finalized",
        occurredAt,
      });

      await expect(
        repositories.cutover.findCutover({ organizationId: ORGANIZATION_ID }),
      ).resolves.toEqual({ status: "finalized", occurredAt });
    });

    it("keeps another organization's cutover absent", async () => {
      const repositories = backend.create();
      repositories.store.cutovers.set(ORGANIZATION_ID, {
        organizationId: ORGANIZATION_ID,
        status: "finalized",
        occurredAt: null,
      });

      await expect(
        repositories.cutover.findCutover({ organizationId: "org_other" }),
      ).resolves.toBeNull();
    });
  });

  describe("when a binding has been written", () => {
    it("reads it back by id and by user", async () => {
      const repositories = backend.create();
      const binding = {
        id: "rb_1",
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        groupId: null,
        apiKeyId: null,
        role: "MEMBER" as const,
        customRoleId: null,
        scopeType: "ORGANIZATION" as const,
        scopeId: ORGANIZATION_ID,
      };
      repositories.store.bindings.push(binding);

      await expect(
        repositories.bindings.tryFindBinding({
          organizationId: ORGANIZATION_ID,
          bindingId: "rb_1",
        }),
      ).resolves.toEqual(binding);
      await expect(
        repositories.bindings.hasBindingsForUser({
          organizationId: ORGANIZATION_ID,
          userId: USER_ID,
        }),
      ).resolves.toBe(true);
      await expect(
        repositories.bindings.findDirectUserBindings({
          organizationId: ORGANIZATION_ID,
          userId: USER_ID,
          bindingIds: ["rb_1"],
        }),
      ).resolves.toEqual([binding]);
    });
  });

  describe("when the epoch is bumped", () => {
    it("counts up from absent", async () => {
      const repositories = backend.create();
      const epoch = MemoryAuthzEpochRepository.create({ memory: repositories.store });

      await expect(epoch.findEpoch({ organizationId: ORGANIZATION_ID })).resolves.toBeNull();
      await epoch.bump({ organizationId: ORGANIZATION_ID });
      await epoch.bump({ organizationId: ORGANIZATION_ID });
      await expect(epoch.findEpoch({ organizationId: ORGANIZATION_ID })).resolves.toBe(2);
    });
  });
});
