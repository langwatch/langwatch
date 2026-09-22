// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A person's directory userName, display name and `active` flag belong to the
 * organization that pushed them, not to the account they sign in with.
 */
import { ScimProtocolError } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { fromDate } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { GrantsFake } from "../../__tests__/support/grants-fake.ts";
import { OrganizationAdministrationFake } from "../../__tests__/support/organization-administration-fake.ts";
import { scimRepositoryFixture } from "../../__tests__/support/scim-repository-fixture.ts";
import type {
  ScimRepository,
  ScimUserRecord,
  ScimUserResourceRecord,
} from "../../repositories/scim.repository.ts";
import type { ScimDepartmentAssignment } from "../scim-cost-center.service.ts";
import type { ScimUserProvisioning } from "../scim-provisioning.service.ts";
import { ScimService } from "../scim.service.ts";
import { QuietScimSyncLifecycle } from "./support/quiet-scim-sync-lifecycle.ts";

const ORGANIZATION = "org-acme";
const OTHER_ORGANIZATION = "org-globex";
const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

function account(overrides: Partial<ScimUserRecord> & { id: string }): ScimUserRecord {
  return {
    name: "Shared Account",
    email: `${overrides.id}@example.test`,
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-02T00:00:00Z"),
    lastLoginAt: null,
    deactivatedAt: null,
    ...overrides,
  };
}

/** A duplicate live name is the store's own refusal, spelled as Postgres spells it. */
class DuplicateName extends Error {
  readonly code = "P2002";
}

/**
 * The directory half of the store, in memory: the resources one organization
 * owns, who holds a membership row, and the accounts underneath. Everything
 * else answers the fixture's empty case.
 */
class DirectoryStore {
  readonly resources = new Map<string, ScimUserResourceRecord>();
  readonly memberships = new Set<string>();
  readonly accounts = new Map<string, ScimUserRecord>();

  private key(organizationId: string, userId: string): string {
    return `${organizationId}:${userId}`;
  }

  live(organizationId: string): ScimUserResourceRecord[] {
    return [...this.resources.values()]
      .filter((row) => row.organizationId === organizationId && row.deletedAt === null)
      .toSorted((a, b) => a.userId.localeCompare(b.userId));
  }

  repository(): ScimRepository {
    const at = fromDate(new Date("2024-06-01T00:00:00Z"));

    return scimRepositoryFixture({
      findUserResource: vi.fn(
        async ({ organizationId, userId }) =>
          this.resources.get(this.key(organizationId, userId)) ?? null,
      ),
      findUserByResourceName: vi.fn(async ({ organizationId, userName }) => {
        const held = this.live(organizationId).find(
          (row) => row.userName === userName.trim().toLowerCase(),
        );

        return held ? (this.accounts.get(held.userId) ?? null) : null;
      }),
      hasLegacyNameConflict: vi.fn(async ({ organizationId, userId, userName }) =>
        [...this.memberships]
          .filter((key) => key.startsWith(`${organizationId}:`))
          .map((key) => key.slice(organizationId.length + 1))
          .some(
            (held) =>
              held !== userId &&
              !this.resources.has(this.key(organizationId, held)) &&
              (this.accounts.get(held)?.email ?? "").toLowerCase() ===
                userName.trim().toLowerCase(),
          ),
      ),
      saveUserResource: vi.fn(async (input) => {
        const userName = input.userName.trim().toLowerCase();
        const taken = this.live(input.organizationId).some(
          (row) => row.userName === userName && row.userId !== input.userId,
        );
        if (taken) throw new DuplicateName(userName);

        const saved = {
          ...input,
          userName,
          deletedAt: null,
          createdAt:
            this.resources.get(this.key(input.organizationId, input.userId))?.createdAt ?? at,
          updatedAt: at,
        };
        this.resources.set(this.key(input.organizationId, input.userId), saved);

        return saved;
      }),
      markUserResourceDeleted: vi.fn(async ({ organizationId, userId, userName, name }) => {
        this.resources.set(this.key(organizationId, userId), {
          organizationId,
          userId,
          userName: userName.trim().toLowerCase(),
          name,
          active: false,
          deletedAt: at,
          createdAt: at,
          updatedAt: at,
        });
      }),
      findMembership: vi.fn(async ({ organizationId, userId }) => {
        const user = this.accounts.get(userId);
        if (!user || !this.memberships.has(this.key(organizationId, userId))) return null;

        return { organizationId, userId, user };
      }),
      addMembership: vi.fn(async ({ organizationId, userId }) => {
        this.memberships.add(this.key(organizationId, userId));
      }),
      removeMembership: vi.fn(async ({ organizationId, userId }) => {
        this.memberships.delete(this.key(organizationId, userId));
      }),
      findOrganizationUsers: vi.fn(async ({ organizationId, userName, startIndex, count }) => {
        const matches = (value: string | null): boolean =>
          userName === void 0 || (value ?? "").toLowerCase() === userName.toLowerCase();
        const claimed = this.live(organizationId)
          .filter((row) => matches(row.userName))
          .map((row) => ({ user: this.accounts.get(row.userId), resource: row }));
        const unclaimed = [...this.memberships]
          .filter((key) => key.startsWith(`${organizationId}:`))
          .map((key) => key.slice(organizationId.length + 1))
          .filter((userId) => !this.resources.has(this.key(organizationId, userId)))
          .toSorted((a, b) => a.localeCompare(b))
          .map((userId) => ({ user: this.accounts.get(userId), resource: null }))
          .filter((row) => matches(row.user?.email ?? null));
        const rows = [...claimed, ...unclaimed].flatMap((row) =>
          row.user ? [{ user: row.user, resource: row.resource }] : [],
        );

        return { rows: rows.slice(startIndex - 1, startIndex - 1 + count), total: rows.length };
      }),
    });
  }
}

class EnterpriseEntitlements implements Pick<EntitlementApi, "getActivePlan"> {
  async getActivePlan() {
    return {
      planSource: "free" as const,
      type: "ENTERPRISE",
      name: "Enterprise",
      free: false,
      maxMembers: 1,
      maxMembersLite: 1,
      maxMessagesPerMonth: 1,
      canPublish: true,
      prices: { USD: 0, EUR: 0 },
    };
  }
}

function departments(): ScimDepartmentAssignment {
  return {
    departmentResolveByNameOrCreate: vi.fn(async () => ({
      id: "department-1",
      organizationId: ORGANIZATION,
      name: "Engineering",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })),
    departmentAssignUser: vi.fn(async () => undefined),
  };
}

function directory(store: DirectoryStore) {
  const minted: ScimUserRecord[] = [];
  const users: ScimUserProvisioning = {
    findById: vi.fn(async ({ id }) => store.accounts.get(id) ?? null),
    findByEmail: vi.fn(
      async ({ email }) =>
        [...store.accounts.values()].find(
          (row) => (row.email ?? "").toLowerCase() === email.toLowerCase(),
        ) ?? null,
    ),
    create: vi.fn(async ({ name, email }) => {
      const created = account({ id: `user-${store.accounts.size + 1}`, name, email });
      store.accounts.set(created.id, created);
      minted.push(created);

      return created;
    }),
  };

  return {
    users,
    minted,
    service: ScimService.create({
      prisma: store.repository(),
      writer: new GrantsFake(),
      users,
      governance: departments(),
      organization: new OrganizationAdministrationFake(),
      entitlements: new EnterpriseEntitlements(),
      lifecycle: new QuietScimSyncLifecycle(),
      provenOffboarding: false,
    }),
  };
}

async function refusalOf(work: Promise<unknown>): Promise<ScimProtocolError> {
  const outcome = await work.catch((error: unknown) => error);
  expect(outcome).toBeInstanceOf(ScimProtocolError);

  return outcome as ScimProtocolError;
}

describe("the organization's own directory resource", () => {
  /** @scenario "Directory lifecycle and profile changes affect only their organization" */
  it("renames and deactivates in one organization without touching the shared account", async () => {
    const store = new DirectoryStore();
    store.accounts.set("user-1", account({ id: "user-1", email: "shared@example.test" }));
    store.memberships.add(`${ORGANIZATION}:user-1`);
    store.memberships.add(`${OTHER_ORGANIZATION}:user-1`);
    const { service, users } = directory(store);

    await expect(
      service.replaceUser({
        id: "user-1",
        organizationId: ORGANIZATION,
        request: {
          schemas: [USER_SCHEMA],
          userName: "alias@example.test",
          name: { givenName: "Tenant", familyName: "Profile" },
          active: true,
        },
      }),
    ).resolves.toMatchObject({
      userName: "alias@example.test",
      name: { givenName: "Tenant", familyName: "Profile" },
    });
    await expect(
      service.getUser({ id: "user-1", organizationId: OTHER_ORGANIZATION }),
    ).resolves.toMatchObject({
      userName: "shared@example.test",
      name: { givenName: "Shared", familyName: "Account" },
    });
    await expect(
      service.listUsers({
        organizationId: ORGANIZATION,
        filter: 'userName eq "shared@example.test"',
      }),
    ).resolves.toMatchObject({ totalResults: 0 });
    await expect(
      service.listUsers({
        organizationId: ORGANIZATION,
        filter: 'userName eq "alias@example.test"',
      }),
    ).resolves.toMatchObject({ totalResults: 1, Resources: [{ id: "user-1" }] });

    await expect(
      service.updateUser({
        id: "user-1",
        organizationId: ORGANIZATION,
        patchRequest: {
          schemas: [PATCH_SCHEMA],
          Operations: [{ op: "replace", path: "active", value: false }],
        },
      }),
    ).resolves.toMatchObject({ active: false });
    expect(store.memberships.has(`${ORGANIZATION}:user-1`)).toBe(false);
    expect(store.memberships.has(`${OTHER_ORGANIZATION}:user-1`)).toBe(true);
    expect(store.accounts.get("user-1")).toEqual(
      account({ id: "user-1", email: "shared@example.test" }),
    );

    await expect(
      service.updateUser({
        id: "user-1",
        organizationId: ORGANIZATION,
        patchRequest: {
          schemas: [PATCH_SCHEMA],
          Operations: [{ op: "replace", path: "active", value: true }],
        },
      }),
    ).resolves.toMatchObject({ active: true });
    expect(store.memberships.has(`${ORGANIZATION}:user-1`)).toBe(false);
    expect(users.findByEmail).not.toHaveBeenCalled();
  });

  /** @scenario "Inactive directory resources remain readable without granting access" */
  it("keeps an inactive resource readable, editable and deletable without membership", async () => {
    const store = new DirectoryStore();
    store.accounts.set("user-0", account({ id: "user-0", email: "member@example.test" }));
    store.memberships.add(`${ORGANIZATION}:user-0`);
    const { service, minted } = directory(store);

    const created = await service.createUser({
      organizationId: ORGANIZATION,
      request: { schemas: [USER_SCHEMA], userName: "inactive@example.test", active: false },
    });
    expect(created.active).toBe(false);
    expect(store.memberships.has(`${ORGANIZATION}:${created.id}`)).toBe(false);
    await expect(
      service.getUser({ organizationId: ORGANIZATION, id: created.id }),
    ).resolves.toMatchObject({ id: created.id, active: false });

    const first = await service.listUsers({ organizationId: ORGANIZATION, count: 1 });
    const second = await service.listUsers({
      organizationId: ORGANIZATION,
      startIndex: 2,
      count: 1,
    });
    expect(first.totalResults).toBe(2);
    expect([...first.Resources, ...second.Resources].map((row) => row.id).toSorted()).toEqual(
      [created.id, "user-0"].toSorted(),
    );

    await expect(
      service.replaceUser({
        organizationId: ORGANIZATION,
        id: created.id,
        request: { schemas: [USER_SCHEMA], userName: "renamed@example.test", active: false },
      }),
    ).resolves.toMatchObject({ userName: "renamed@example.test", active: false });
    expect(store.memberships.has(`${ORGANIZATION}:${created.id}`)).toBe(false);

    await service.deleteUser({ organizationId: ORGANIZATION, id: created.id });
    expect(
      (await refusalOf(service.getUser({ organizationId: ORGANIZATION, id: created.id }))).response,
    ).toMatchObject({ status: "404" });
    await expect(
      service.listUsers({
        organizationId: ORGANIZATION,
        filter: 'userName eq "renamed@example.test"',
      }),
    ).resolves.toMatchObject({ totalResults: 0 });
    expect(
      (
        await refusalOf(
          service.replaceUser({
            organizationId: ORGANIZATION,
            id: created.id,
            request: { schemas: [USER_SCHEMA], userName: "inactive@example.test", active: true },
          }),
        )
      ).response,
    ).toMatchObject({ status: "404" });

    const revived = await service.createUser({
      organizationId: ORGANIZATION,
      request: { schemas: [USER_SCHEMA], userName: "inactive@example.test", active: false },
    });
    expect(revived.id).toBe(created.id);
    expect(minted).toHaveLength(1);
    expect(store.resources.get(`${ORGANIZATION}:${created.id}`)?.deletedAt).toBeNull();
  });

  /** @scenario "Directory usernames stay unique without mutating a conflicting resource" */
  it("refuses a name another resource holds before changing profile or access", async () => {
    const store = new DirectoryStore();
    store.accounts.set("user-1", account({ id: "user-1", email: "first@example.test" }));
    store.accounts.set("user-2", account({ id: "user-2", email: "second@example.test" }));
    store.memberships.add(`${ORGANIZATION}:user-1`);
    store.memberships.add(`${ORGANIZATION}:user-2`);
    const { service } = directory(store);

    // Before either is adopted, the member's own address is the name it answers
    // to, and a directory may not take it from them.
    expect(
      (
        await refusalOf(
          service.replaceUser({
            id: "user-1",
            organizationId: ORGANIZATION,
            request: { schemas: [USER_SCHEMA], userName: "SECOND@example.test", active: false },
          }),
        )
      ).response,
    ).toMatchObject({ status: "409", scimType: "uniqueness" });
    expect(store.resources.size).toBe(0);
    expect(store.memberships.has(`${ORGANIZATION}:user-1`)).toBe(true);

    for (const [id, userName] of [
      ["user-1", "alias@example.test"],
      ["user-2", "second@example.test"],
    ] as const) {
      await service.replaceUser({
        id,
        organizationId: ORGANIZATION,
        request: { schemas: [USER_SCHEMA], userName, active: true },
      });
    }
    const before = store.resources.get(`${ORGANIZATION}:user-2`);

    expect(
      (
        await refusalOf(
          service.replaceUser({
            id: "user-2",
            organizationId: ORGANIZATION,
            request: { schemas: [USER_SCHEMA], userName: "alias@example.test", active: false },
          }),
        )
      ).response,
    ).toMatchObject({ status: "409", scimType: "uniqueness" });
    expect(
      (
        await refusalOf(
          service.updateUser({
            id: "user-2",
            organizationId: ORGANIZATION,
            patchRequest: {
              schemas: [PATCH_SCHEMA],
              Operations: [
                { op: "replace", path: "active", value: false },
                { op: "replace", path: "userName", value: "ALIAS@example.test" },
              ],
            },
          }),
        )
      ).response,
    ).toMatchObject({ status: "409", scimType: "uniqueness" });
    expect(store.resources.get(`${ORGANIZATION}:user-2`)).toEqual(before);
    expect(store.memberships.has(`${ORGANIZATION}:user-2`)).toBe(true);

    await service.deleteUser({ id: "user-1", organizationId: ORGANIZATION });
    await expect(
      service.replaceUser({
        id: "user-2",
        organizationId: ORGANIZATION,
        request: { schemas: [USER_SCHEMA], userName: "alias@example.test", active: true },
      }),
    ).resolves.toMatchObject({ userName: "alias@example.test" });
  });

  it("answers a raced duplicate name with 409 rather than the store's error", async () => {
    const store = new DirectoryStore();
    store.accounts.set("user-1", account({ id: "user-1", email: "first@example.test" }));
    store.accounts.set("user-2", account({ id: "user-2", email: "second@example.test" }));
    store.memberships.add(`${ORGANIZATION}:user-1`);
    store.memberships.add(`${ORGANIZATION}:user-2`);
    const { service } = directory(store);
    await service.replaceUser({
      id: "user-1",
      organizationId: ORGANIZATION,
      request: { schemas: [USER_SCHEMA], userName: "alias@example.test", active: true },
    });
    const repository = store.repository();
    vi.spyOn(repository, "findUserByResourceName").mockResolvedValue(null);

    const raced = ScimService.create({
      prisma: repository,
      writer: new GrantsFake(),
      users: directory(store).users,
      governance: departments(),
      organization: new OrganizationAdministrationFake(),
      entitlements: new EnterpriseEntitlements(),
      lifecycle: new QuietScimSyncLifecycle(),
      provenOffboarding: false,
    });

    expect(
      (
        await refusalOf(
          raced.replaceUser({
            id: "user-2",
            organizationId: ORGANIZATION,
            request: { schemas: [USER_SCHEMA], userName: "alias@example.test", active: true },
          }),
        )
      ).response,
    ).toMatchObject({ status: "409", scimType: "uniqueness" });
  });
});
