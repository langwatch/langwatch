// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a directory push does to the people it names: who it creates, who it
 * keeps, what a removal leaves, and how little an inactive or departed person
 * lets it touch. `ScimService` runs over the in-memory SCIM store, so the
 * rows asserted are the ones the service itself wrote.
 * @see enterprise/modules/scim/specs/scim-connection-sync.feature
 */
import {
  SCIM_ENTERPRISE_USER_SCHEMA,
  ScimProtocolError,
  type ScimCreateUserRequest,
} from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { describe, expect, it, vi } from "vitest";

import { GrantsFake } from "../../__tests__/support/grants-fake.ts";
import { HeldConnectionsFake } from "../../__tests__/support/held-connections-fake.ts";
import { OrganizationAdministrationFake } from "../../__tests__/support/organization-administration-fake.ts";
import { MemoryScimRepository } from "../../repositories/memory/memory.scim.repository.ts";
import type { ScimUserRecord } from "../../repositories/scim.repository.ts";
import type { ScimDepartmentAssignment } from "../scim-cost-center.service.ts";
import type { ScimUserProvisioning } from "../scim-provisioning.service.ts";
import { ScimService } from "../scim.service.ts";
import { QuietScimSyncLifecycle } from "./support/quiet-scim-sync-lifecycle.ts";

const ACME = "org_acme";
const GLOBEX = "org_globex";
const OKTA = "conn_okta_primary";
const ENTRA = "conn_entra_contractors";
const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

function account(id: string, email: string): ScimUserRecord {
  return {
    id,
    name: "Ada Lovelace",
    email,
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-02T00:00:00Z"),
    lastLoginAt: new Date("2024-02-01T00:00:00Z"),
    deactivatedAt: null,
  };
}

class EnterpriseEntitlements implements Pick<EntitlementApi, "getActivePlan"> {
  async getActivePlan() {
    return {
      planSource: "free" as const,
      type: "ENTERPRISE",
      name: "Enterprise",
      free: false,
      maxMembers: 10,
      maxMembersLite: 10,
      maxMessagesPerMonth: 1,
      canPublish: true,
      prices: { USD: 0, EUR: 0 },
    };
  }
}

/** Everything the service reaches, kept where a test can read what was asked of it. */
function world() {
  const store = MemoryScimRepository.create();
  const writer = new GrantsFake();
  const organization = new OrganizationAdministrationFake();
  const departments = {
    departmentResolveByNameOrCreate: vi.fn(async () => ({
      id: "department-1",
      organizationId: ACME,
      name: "Engineering",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })),
    departmentAssignUser: vi.fn(async () => undefined),
  } satisfies ScimDepartmentAssignment;
  const users = {
    findById: vi.fn(async ({ id }) => store.users.get(id) ?? null),
    findByEmail: vi.fn(
      async ({ email }) =>
        [...store.users.values()].find(
          (row) => (row.email ?? "").toLowerCase() === email.toLowerCase(),
        ) ?? null,
    ),
    create: vi.fn(async ({ name, email }) => {
      const created = account(`user_${store.users.size + 1}`, email);
      store.users.set(created.id, { ...created, name, lastLoginAt: null });

      return store.users.get(created.id)!;
    }),
  } satisfies ScimUserProvisioning;
  const service = ScimService.create({
    connections: HeldConnectionsFake.of([OKTA, ENTRA]),
    prisma: store,
    writer,
    users,
    governance: departments,
    organization,
    entitlements: new EnterpriseEntitlements(),
    lifecycle: new QuietScimSyncLifecycle(),
    provenOffboarding: false,
    tokenPepper: "scim-test-pepper",
  });

  return {
    store,
    writer,
    organization,
    departments,
    users,
    service,
    live: (organizationId: string) =>
      store.resources.filter((row) => row.organizationId === organizationId && !row.deletedAt),
    membershipsIn: (organizationId: string) =>
      store.memberships.filter((row) => row.organizationId === organizationId),
    /** A person who was already here: an account and a membership somewhere. */
    seed: ({
      id,
      email,
      memberOf,
    }: {
      id: string;
      email: string;
      memberOf: { organizationId: string; role: string }[];
    }) => {
      store.users.set(id, account(id, email));
      for (const { organizationId, role } of memberOf) {
        store.memberships.push({ organizationId, userId: id, role });
      }
    },
  };
}

type World = ReturnType<typeof world>;

function createRequest({
  userName,
  externalId,
  active = true,
  costCenter,
}: {
  userName: string;
  externalId?: string;
  active?: boolean;
  costCenter?: string;
}): ScimCreateUserRequest {
  return {
    schemas: [USER_SCHEMA],
    userName,
    active,
    ...(externalId === undefined ? {} : { externalId }),
    ...(costCenter === undefined ? {} : { [SCIM_ENTERPRISE_USER_SCHEMA]: { costCenter } }),
  };
}

function push({
  service,
  connectionId = OKTA,
  organizationId = ACME,
  ...request
}: Parameters<typeof createRequest>[0] & {
  service: World["service"];
  connectionId?: string;
  organizationId?: string;
}) {
  return service.createUser({
    organizationId,
    connectionId,
    request: createRequest(request),
  });
}

function deactivate({ service, id }: { service: World["service"]; id: string }) {
  return service.updateUser({
    id,
    organizationId: ACME,
    connectionId: OKTA,
    patchRequest: {
      schemas: [PATCH_SCHEMA],
      Operations: [{ op: "replace", path: "active", value: false }],
    },
  });
}

/** Nothing that grants access was written: no membership grant, no role binding, no seat. */
function expectNoAccessWritten({ writer, departments }: World) {
  expect(writer.attachBindings).not.toHaveBeenCalled();
  expect(writer.createBinding).not.toHaveBeenCalled();
  expect(writer.applyMemberBindings).not.toHaveBeenCalled();
  expect(writer.createGrant).not.toHaveBeenCalled();
  expect(departments.departmentAssignUser).not.toHaveBeenCalled();
}

async function refusalOf(work: Promise<unknown>): Promise<ScimProtocolError> {
  const outcome = await work.catch((error: unknown) => error);
  expect(outcome).toBeInstanceOf(ScimProtocolError);

  return outcome as ScimProtocolError;
}

describe("a directory creating a person who is inactive", () => {
  describe("when the same inactive creation, with a cost center, arrives twice", () => {
    /** @scenario Creating an inactive directory person grants no access */
    it("leaves one inactive resource the directory owns and no access of any kind", async () => {
      const w = world();
      const request = {
        service: w.service,
        userName: "ghost@acme.test",
        externalId: "okta-ghost",
        active: false,
        costCenter: "Engineering",
      };

      const first = await push(request);
      const second = await push(request);

      expect(second.id).toBe(first.id);
      expect(w.live(ACME)).toEqual([
        expect.objectContaining({ userId: first.id, userName: "ghost@acme.test", active: false }),
      ]);
      expect(w.store.directoryIdentities).toEqual([
        { organizationId: ACME, connectionId: OKTA, externalId: "okta-ghost", userId: first.id },
      ]);
      expect(w.store.users.get(first.id)?.deactivatedAt).toBeNull();
      expect(w.membershipsIn(ACME)).toEqual([]);
      expectNoAccessWritten(w);
    });
  });

  describe("when the address already has an active account in another organization", () => {
    /** @scenario Inactive provisioning cannot deactivate an unowned account in another organization */
    it("records an inactive resource here and leaves the account and its membership alone", async () => {
      const w = world();
      w.seed({
        id: "user_ada",
        email: "ada@shared.test",
        memberOf: [{ organizationId: GLOBEX, role: "ADMIN" }],
      });
      const before = structuredClone(w.store.users.get("user_ada"));

      const created = await push({
        service: w.service,
        userName: "ada@shared.test",
        externalId: "okta-ada",
        active: false,
      });

      expect(created.id).toBe("user_ada");
      expect(w.live(ACME)).toEqual([
        expect.objectContaining({ userId: "user_ada", active: false }),
      ]);
      expect(w.live(GLOBEX)).toEqual([]);
      expect(w.store.users.get("user_ada")).toEqual(before);
      expect(w.users.create).not.toHaveBeenCalled();
      expect(w.store.memberships).toEqual([
        { organizationId: GLOBEX, userId: "user_ada", role: "ADMIN" },
      ]);
      expect(w.store.directoryIdentities).toEqual([
        { organizationId: ACME, connectionId: OKTA, externalId: "okta-ada", userId: "user_ada" },
      ]);
      expectNoAccessWritten(w);
    });
  });

  describe("when the person a directory still owns has left the organization", () => {
    /** @scenario Retained directory ownership cannot deactivate an account that has left the organization */
    it("marks its own resource inactive and leaves the account and the other organization alone", async () => {
      const w = world();
      const created = await push({
        service: w.service,
        userName: "ada@shared.test",
        externalId: "okta-ada",
      });
      w.store.memberships.push({ organizationId: GLOBEX, userId: created.id, role: "ADMIN" });
      w.store.memberships.splice(
        w.store.memberships.findIndex((row) => row.organizationId === ACME),
        1,
      );
      const before = structuredClone(w.store.users.get(created.id));

      const resubmitted = await push({
        service: w.service,
        userName: "ada@shared.test",
        externalId: "okta-ada",
        active: false,
      });

      expect(resubmitted.id).toBe(created.id);
      expect(w.live(ACME)).toEqual([
        expect.objectContaining({ userId: created.id, active: false }),
      ]);
      expect(w.store.users.get(created.id)).toEqual(before);
      expect(w.membershipsIn(GLOBEX)).toEqual([
        { organizationId: GLOBEX, userId: created.id, role: "ADMIN" },
      ]);
      expect(w.membershipsIn(ACME)).toEqual([]);
      expect(w.writer.offboardMember).not.toHaveBeenCalled();
    });
  });

  describe("when a departed person is submitted for creation as inactive again", () => {
    /** @scenario Repeating an inactive creation does not restore a departed person's access */
    it("keeps the same resource inactive and restores no membership, binding or seat", async () => {
      const w = world();
      const created = await push({
        service: w.service,
        userName: "ada@acme.test",
        externalId: "okta-ada",
        costCenter: "Engineering",
      });
      await deactivate({ service: w.service, id: created.id });
      const membershipsBefore = w.membershipsIn(ACME);
      const grantsBefore = w.writer.attachBindings.mock.calls.length;
      const seatsBefore = w.departments.departmentAssignUser.mock.calls.length;

      const again = await push({
        service: w.service,
        userName: "ada@acme.test",
        externalId: "okta-ada",
        active: false,
        costCenter: "Engineering",
      });

      expect(again.id).toBe(created.id);
      expect(w.live(ACME)).toEqual([
        expect.objectContaining({ userId: created.id, active: false }),
      ]);
      expect(w.membershipsIn(ACME)).toEqual(membershipsBefore);
      expect(w.writer.attachBindings.mock.calls).toHaveLength(grantsBefore);
      expect(w.departments.departmentAssignUser.mock.calls).toHaveLength(seatsBefore);
    });
  });
});

describe("a directory deleting a person it no longer has in the organization", () => {
  describe("when their account is active in another organization under another directory", () => {
    /** @scenario Deleting a former directory resource preserves access in other organizations */
    it("removes only the old directory's ownership and identifiers", async () => {
      const w = world();
      const created = await push({
        service: w.service,
        userName: "ada@shared.test",
        externalId: "okta-ada",
      });
      w.store.memberships.push({ organizationId: GLOBEX, userId: created.id, role: "ADMIN" });
      await w.store.rememberDirectoryIdentity({
        organizationId: GLOBEX,
        connectionId: ENTRA,
        externalId: "entra-ada",
        releasedConnectionIds: [],
        userId: created.id,
      });
      w.store.memberships.splice(
        w.store.memberships.findIndex((row) => row.organizationId === ACME),
        1,
      );
      const before = structuredClone(w.store.users.get(created.id));

      await w.service.deleteUser({ id: created.id, organizationId: ACME, connectionId: OKTA });

      expect(w.live(ACME)).toEqual([]);
      expect(w.store.directoryIdentities).toEqual([
        {
          organizationId: GLOBEX,
          connectionId: ENTRA,
          externalId: "entra-ada",
          userId: created.id,
        },
      ]);
      await expect(w.store.findDirectoryExternalIds({ connectionIds: [OKTA] })).resolves.toEqual(
        [],
      );
      expect(w.store.users.get(created.id)).toEqual(before);
      expect(w.membershipsIn(GLOBEX)).toEqual([
        { organizationId: GLOBEX, userId: created.id, role: "ADMIN" },
      ]);
      expect(w.writer.offboardMember).not.toHaveBeenCalled();
    });
  });
});

describe("a directory push that arrives for a person", () => {
  describe("when nobody has an account for them here", () => {
    /** @scenario A directory push provisions whatever the sign-in door would do */
    it("creates the account and lands the membership without asking anything else", async () => {
      const w = world();

      const created = await push({
        service: w.service,
        userName: "newhire@acme.test",
        externalId: "okta-new",
      });

      expect(w.users.create).toHaveBeenCalledTimes(1);
      expect(w.store.users.get(created.id)).toMatchObject({ email: "newhire@acme.test" });
      expect(w.membershipsIn(ACME)).toEqual([
        { organizationId: ACME, userId: created.id, role: "MEMBER" },
      ]);
      expect(w.live(ACME)).toEqual([expect.objectContaining({ userId: created.id, active: true })]);
      // The directory already decided: the only things asked are who holds the
      // address and to mint the account; no administrator or department check.
      expect(w.users.findByEmail).toHaveBeenCalledTimes(1);
      expect(w.organization.assertRemovalKeepsAnAdministrator).not.toHaveBeenCalled();
      expect(w.departments.departmentResolveByNameOrCreate).not.toHaveBeenCalled();
    });
  });

  describe("when the same creation that already landed arrives again", () => {
    /** @scenario A directory push that changes nothing changes nothing */
    it("is refused with 409 and they still hold exactly one membership", async () => {
      const w = world();
      const first = await push({ service: w.service, userName: "ada@acme.test" });

      const refusal = await refusalOf(push({ service: w.service, userName: "ada@acme.test" }));

      expect(refusal.response).toMatchObject({ status: "409" });
      expect(w.membershipsIn(ACME)).toEqual([
        { organizationId: ACME, userId: first.id, role: "MEMBER" },
      ]);
      expect(w.users.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("when it carries the identifier the directory already holds, under a changed address", () => {
    /** @scenario A directory push follows the person, not the address */
    it("resolves them by that identifier and creates no account for the new address", async () => {
      const w = world();
      const first = await push({
        service: w.service,
        userName: "ada@acme.test",
        externalId: "okta-ada",
      });

      const second = await push({
        service: w.service,
        userName: "ada.lovelace@acme.test",
        externalId: "okta-ada",
      });

      expect(second.id).toBe(first.id);
      expect(second.userName).toBe("ada.lovelace@acme.test");
      expect(w.users.create).toHaveBeenCalledTimes(1);
      expect(w.users.findByEmail).not.toHaveBeenCalledWith({ email: "ada.lovelace@acme.test" });
      expect(w.live(ACME)).toEqual([
        expect.objectContaining({ userId: first.id, userName: "ada.lovelace@acme.test" }),
      ]);
      expect(w.membershipsIn(ACME)).toHaveLength(1);
      expect(w.store.directoryIdentities).toEqual([
        { organizationId: ACME, connectionId: OKTA, externalId: "okta-ada", userId: first.id },
      ]);
    });
  });

  describe("when the directory had removed them and pushes them again", () => {
    /** @scenario A removed person the directory pushes again comes back */
    it("restores the membership and they still hold exactly one account", async () => {
      const w = world();
      const first = await push({
        service: w.service,
        userName: "ada@acme.test",
        externalId: "okta-ada",
      });
      await w.service.deleteUser({ id: first.id, organizationId: ACME, connectionId: OKTA });
      expect(w.membershipsIn(ACME)).toEqual([]);

      const back = await push({
        service: w.service,
        userName: "ada@acme.test",
        externalId: "okta-ada",
      });

      expect(back.id).toBe(first.id);
      expect(w.membershipsIn(ACME)).toEqual([
        { organizationId: ACME, userId: first.id, role: "MEMBER" },
      ]);
      expect(
        [...w.store.users.values()].filter((row) => row.email === "ada@acme.test"),
      ).toHaveLength(1);
      expect(w.users.create).toHaveBeenCalledTimes(1);
      expect(w.live(ACME)).toEqual([expect.objectContaining({ userId: first.id, active: true })]);
    });
  });

  describe("when the directory removes a person", () => {
    /** @scenario A removal leaves nothing behind in the organization */
    it("leaves no membership or role binding there and keeps their account", async () => {
      const w = world();
      const first = await push({
        service: w.service,
        userName: "ada@acme.test",
        externalId: "okta-ada",
      });
      const account = structuredClone(w.store.users.get(first.id));

      await w.service.deleteUser({ id: first.id, organizationId: ACME, connectionId: OKTA });

      expect(w.membershipsIn(ACME)).toEqual([]);
      expect(w.writer.offboardMember).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ACME, userId: first.id }),
      );
      expect(w.store.users.get(first.id)).toEqual(account);
      expect(w.live(ACME)).toEqual([]);
    });
  });
});
