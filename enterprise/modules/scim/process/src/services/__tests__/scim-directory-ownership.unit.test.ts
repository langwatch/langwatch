// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Who a directory owns: a connection owns the people it provisions whether or
 * not it sends an externalId, no sibling writes them, a return restores
 * nothing, and a retired connection lets its people go to a successor.
 * @see enterprise/modules/scim/specs/scim-connection-sync.feature
 */
import type { ScimCreateUserRequest } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { describe, expect, it, vi } from "vitest";

import { GrantsFake } from "../../__tests__/support/grants-fake.ts";
import { HeldConnectionsFake } from "../../__tests__/support/held-connections-fake.ts";
import { OrganizationAdministrationFake } from "../../__tests__/support/organization-administration-fake.ts";
import { MemoryScimRepository } from "../../repositories/memory/memory.scim.repository.ts";
import type { ScimDepartmentAssignment } from "../scim-cost-center.service.ts";
import type { ScimUserProvisioning } from "../scim-provisioning.service.ts";
import { ScimService } from "../scim.service.ts";
import { QuietScimSyncLifecycle } from "./support/quiet-scim-sync-lifecycle.ts";

const ACME = "org_acme";
const GLOBEX = "org_globex";
const OKTA = "conn_okta_primary";
const ENTRA = "conn_entra_contractors";
const GLOBEX_OKTA = "conn_globex_okta";
const REPLACEMENT = "conn_okta_replacement";
const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

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

function world() {
  const store = MemoryScimRepository.create();
  const writer = new GrantsFake();
  const connections = HeldConnectionsFake.of([OKTA, ENTRA, GLOBEX_OKTA]);
  const users = {
    findById: vi.fn(async ({ id }) => store.users.get(id) ?? null),
    findByEmail: vi.fn(
      async ({ email }) =>
        [...store.users.values()].find((row) => row.email?.toLowerCase() === email.toLowerCase()) ??
        null,
    ),
    create: vi.fn(async ({ name, email }) => {
      const id = `user_${store.users.size + 1}`;
      store.users.set(id, {
        id,
        name,
        email,
        emailVerified: true,
        image: null,
        pendingSsoSetup: false,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        lastLoginAt: null,
        deactivatedAt: null,
      });
      return store.users.get(id)!;
    }),
  } satisfies ScimUserProvisioning;
  const departments = {
    departmentResolveByNameOrCreate: vi.fn(),
    departmentAssignUser: vi.fn(async () => undefined),
  } satisfies ScimDepartmentAssignment;
  const service = ScimService.create({
    prisma: store,
    writer,
    users,
    governance: departments,
    organization: new OrganizationAdministrationFake(),
    entitlements: new EnterpriseEntitlements(),
    lifecycle: new QuietScimSyncLifecycle(),
    provenOffboarding: false,
    tokenPepper: "scim-test-pepper",
    connections,
  });

  return { store, writer, connections, service };
}

type World = ReturnType<typeof world>;

function createRequest({
  userName,
  externalId,
  active = true,
}: {
  userName: string;
  externalId?: string;
  active?: boolean;
}): ScimCreateUserRequest {
  return {
    schemas: [USER_SCHEMA],
    userName,
    active,
    ...(externalId === undefined ? {} : { externalId }),
  };
}

function setActive({
  w,
  id,
  active,
  connectionId = OKTA,
  organizationId = ACME,
}: {
  w: World;
  id: string;
  active: boolean;
  connectionId?: string | null;
  organizationId?: string;
}) {
  return w.service.updateUser({
    id,
    organizationId,
    connectionId,
    patchRequest: {
      schemas: [PATCH_SCHEMA],
      Operations: [{ op: "replace", path: "active", value: active }],
    },
  });
}

describe("a directory that sends no externalId", () => {
  describe.each([
    ["absent", undefined],
    ["blank", ""],
  ])("when the identifier is %s", (_label, externalId) => {
    /** @scenario A directory manages a person even when externalId is absent */
    it("owns the person once, invents no identifier and shows no other organization", async () => {
      const w = world();
      const created = await w.service.createUser({
        organizationId: ACME,
        connectionId: OKTA,
        request: createRequest({ userName: "ada@acme.test", externalId }),
      });
      await w.service.replaceUser({
        id: created.id,
        organizationId: ACME,
        connectionId: OKTA,
        request: createRequest({ userName: "ada@acme.test", externalId }),
      });

      expect(w.store.directoryUsers).toEqual([
        { organizationId: ACME, connectionId: OKTA, userId: created.id },
      ]);
      expect(w.store.directoryIdentities).toEqual([]);
      await expect(w.service.findDirectoryOwnership({ connectionIds: [OKTA] })).resolves.toEqual([
        { connectionId: OKTA, userId: created.id },
      ]);
      await expect(
        w.store.findDirectoryConnectionsForUser({ organizationId: GLOBEX, userId: created.id }),
      ).resolves.toEqual([]);
    });
  });

  describe("when another connection of the organization pushes the person", () => {
    /** @scenario Omitting externalId does not let another connection change the person */
    it("refuses with scim_write_outside_connection and leaves the person as they were", async () => {
      const w = world();
      const created = await w.service.createUser({
        organizationId: ACME,
        connectionId: OKTA,
        request: createRequest({ userName: "ada@acme.test" }),
      });
      const memberships = structuredClone(w.store.memberships);

      await expect(
        setActive({ w, id: created.id, active: false, connectionId: ENTRA }),
      ).rejects.toMatchObject({ code: "scim_write_outside_connection" });
      await expect(
        w.store.findUserResource({ organizationId: ACME, userId: created.id }),
      ).resolves.toMatchObject({ active: true, deletedAt: null });
      expect(w.store.memberships).toEqual(memberships);
      expect(w.writer.offboardMember).not.toHaveBeenCalled();
    });
  });

  describe("when the same connection brings a removed person back", () => {
    /** @scenario A directory can reactivate its person without an externalId */
    it("lets them sign in again and restores neither membership nor bindings", async () => {
      const w = world();
      const created = await w.service.createUser({
        organizationId: ACME,
        connectionId: OKTA,
        request: createRequest({ userName: "ada@acme.test" }),
      });
      await setActive({ w, id: created.id, active: false });
      w.store.memberships.splice(0, w.store.memberships.length);
      const bindingWrites = w.writer.attachBindings.mock.calls.length;

      await w.service.createUser({
        organizationId: ACME,
        connectionId: OKTA,
        request: createRequest({ userName: "ada@acme.test" }),
      });

      await expect(
        w.store.findUserResource({ organizationId: ACME, userId: created.id }),
      ).resolves.toMatchObject({ active: true, deletedAt: null });
      expect(w.store.directoryUsers).toEqual([
        { organizationId: ACME, connectionId: OKTA, userId: created.id },
      ]);
      expect(w.store.memberships).toEqual([]);
      expect(w.writer.attachBindings.mock.calls).toHaveLength(bindingWrites);
      expect(w.writer.applyMemberBindings).not.toHaveBeenCalled();
    });
  });
});

describe("directory ownership across organizations and connection retirement", () => {
  /** @scenario Directory ownership is isolated by organization and follows connection retirement */
  it("scopes ownership to the organization and releases it when the owner retires", async () => {
    const w = world();
    const ada = await w.service.createUser({
      organizationId: ACME,
      connectionId: OKTA,
      request: createRequest({ userName: "ada@shared.test", externalId: "okta-ada" }),
    });
    await w.service.createUser({
      organizationId: GLOBEX,
      connectionId: GLOBEX_OKTA,
      request: createRequest({ userName: "ada@shared.test", externalId: "globex-ada" }),
    });

    await expect(setActive({ w, id: ada.id, active: true })).resolves.toBeDefined();
    await expect(
      setActive({ w, id: ada.id, active: true, connectionId: GLOBEX_OKTA, organizationId: GLOBEX }),
    ).resolves.toBeDefined();
    await expect(
      setActive({ w, id: ada.id, active: true, connectionId: ENTRA }),
    ).rejects.toMatchObject({ code: "scim_write_outside_connection" });
    await expect(
      w.store.findDirectoryConnectionsForUser({ organizationId: ACME, userId: ada.id }),
    ).resolves.toEqual([OKTA]);

    // Replaced at finalization: the replacement inherits, and its write takes the claim over.
    w.connections.hold({
      connectionId: REPLACEMENT,
      replacesConnectionId: OKTA,
      migrationPhase: "FINALIZING",
    });
    await expect(
      setActive({ w, id: ada.id, active: true, connectionId: REPLACEMENT }),
    ).resolves.toBeDefined();
    await expect(
      w.store.findDirectoryConnectionsForUser({ organizationId: ACME, userId: ada.id }),
    ).resolves.toEqual([REPLACEMENT]);

    // Torn down: the retired owner's people go to whoever provisions them next.
    w.connections.hold({ connectionId: REPLACEMENT, state: "TORN_DOWN" });
    await expect(
      setActive({ w, id: ada.id, active: true, connectionId: ENTRA }),
    ).resolves.toBeDefined();
    await w.service.revokeTokensForConnection({ organizationId: ACME, connectionId: ENTRA });
    expect(w.store.directoryUsers.filter((row) => row.connectionId === ENTRA)).toEqual([]);
    await expect(
      w.store.findDirectoryConnectionsForUser({ organizationId: GLOBEX, userId: ada.id }),
    ).resolves.toEqual([GLOBEX_OKTA]);

    // A token minted before connections existed keeps the organization-wide reach it had.
    await setActive({ w, id: ada.id, active: true, connectionId: OKTA });
    await expect(
      setActive({ w, id: ada.id, active: true, connectionId: null }),
    ).resolves.toBeDefined();
  });
});
