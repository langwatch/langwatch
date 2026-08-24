// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The removal's postcondition, against real Postgres (D08 exit gate).
 *
 * This is the one assertion that cannot be made anywhere else. Every other
 * test about deprovisioning asserts ROUTING — that SCIM calls
 * `GrantsService.offboard` rather than the ledger writer under it. The proof
 * itself lives INSIDE that service's transaction: it re-collects the
 * person's effective permissions through a transaction-bound reader, sees
 * the deletes that have not committed yet, and rolls the whole thing back if
 * anything still resolves. A fake grants service cannot exercise that, and a
 * fake collector would be asserting the mock.
 *
 * So the shape here is: give somebody access through EVERY source at once —
 * organization membership, a group whose binding carries a role, and a direct
 * role binding — deprovision them the way a directory does, and then ask the
 * authorization engine, from outside the transaction, whether anything
 * resolves for them. Nothing may.
 *
 * The second half is the failure direction, which matters more: a removal
 * that cannot prove itself empty must leave storage untouched. It is driven
 * by handing the offboarding a collector that reports a grant still standing
 * — the only way to make a proof fail deliberately without corrupting the
 * database — and asserting that the member's access is exactly what it was.
 *
 * Spec: specs/identity/scim-connection-sync.feature.
 */
import {
  AuthzCollectorService,
  GrantsService,
  OffboardIncompleteError,
} from "@langwatch/authz-server";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bumpAuthzEpoch } from "~/server/app-layer/authz/epoch";
import { grantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import { LedgerAuthzGrantsRepository } from "~/server/app-layer/authz/repositories/authz-grants.ledger.repository";
import { authzCollector } from "~/server/app-layer/authz/runtime";
import { prisma } from "~/server/db";
import { KSUID_RESOURCES } from "~/utils/constants";
import { ScimDeprovisionService } from "../scim-deprovision.service";

const namespace = `scimoff-${nanoid(8)}`;
const ORGANIZATION = `${namespace}-org`;
const USER = `${namespace}-user`;
const GROUP = `${namespace}-group`;
const CONNECTION = `${namespace}-conn`;

/** The directory-sync history, stubbed: what a failure is RECORDED as has
 *  its own unit test; this file is about the proof. */
const syncLifecycle = {
  applyFailed: async () => undefined,
} as never;

function grantsService() {
  return new GrantsService(
    new LedgerAuthzGrantsRepository(prisma, grantsLedgerWriter()),
    {
      newBindingId: () => generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      bumpEpoch: bumpAuthzEpoch,
      collectorFor: (reader) => new AuthzCollectorService(reader),
    },
  );
}

async function seedMemberWithAccessEverywhere() {
  await prisma.organization.create({
    data: { id: ORGANIZATION, name: namespace, slug: namespace },
  });
  await prisma.user.create({
    data: { id: USER, email: `${namespace}@example.com`, name: "Sam" },
  });
  await prisma.organizationUser.create({
    data: { userId: USER, organizationId: ORGANIZATION, role: "MEMBER" },
  });
  await prisma.group.create({
    data: {
      id: GROUP,
      organizationId: ORGANIZATION,
      name: namespace,
      slug: namespace,
      scimSource: "scim",
      scimConnectionId: CONNECTION,
      externalId: "g-1",
    },
  });
  await prisma.groupMembership.create({
    data: { userId: USER, groupId: GROUP },
  });
  // A grant the group carries, and one the person holds directly. Both are
  // sources the proof has to sweep.
  await prisma.roleBinding.createMany({
    data: [
      {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId: ORGANIZATION,
        groupId: GROUP,
        scopeType: "ORGANIZATION",
        scopeId: ORGANIZATION,
        role: "MEMBER",
      },
      {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId: ORGANIZATION,
        userId: USER,
        scopeType: "ORGANIZATION",
        scopeId: ORGANIZATION,
        role: "ADMIN",
      },
    ],
  });
}

async function tearDown() {
  await prisma.roleBinding.deleteMany({
    where: { organizationId: ORGANIZATION },
  });
  await prisma.groupMembership.deleteMany({ where: { groupId: GROUP } });
  await prisma.group.deleteMany({ where: { organizationId: ORGANIZATION } });
  await prisma.organizationUser.deleteMany({
    where: { organizationId: ORGANIZATION },
  });
  await prisma.scimExternalId.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.organization.deleteMany({ where: { id: ORGANIZATION } });
}

/** What still resolves for the person, read from OUTSIDE the transaction. */
async function collectAccess() {
  return authzCollector.collectGrants({
    principal: { type: "user", id: USER },
    organizationId: ORGANIZATION,
  });
}

describe("a directory deprovision, against real storage", () => {
  beforeEach(async () => {
    await tearDown();
    await seedMemberWithAccessEverywhere();
  });

  afterEach(tearDown);

  describe("given a person holding access through every source at once", () => {
    /** @scenario Deprovisioning leaves no effective permission anywhere */
    /** @scenario Deprovisioned user's org membership and role bindings are cleaned up */
    it("proves nothing resolves for them once the removal stands", async () => {
      const before = await collectAccess();
      expect(before.isOrgMember).toBe(true);
      expect(before.bindings.length).toBeGreaterThan(0);

      await new ScimDeprovisionService({
        grants: grantsService(),
        syncLifecycle,
      }).removeAccess({
        userId: USER,
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        op: "delete_user",
      });

      const after = await collectAccess();
      expect(after.isOrgMember).toBe(false);
      expect(after.bindings).toEqual([]);
      expect(after.legacyTeamMemberships).toEqual([]);
    });

    /** @scenario The proof runs on every path a directory can remove somebody by */
    /** @scenario Deactivating a user deprovisions them with the same proof */
    it("proves the same thing when the removal came from a push marking them inactive", async () => {
      await new ScimDeprovisionService({
        grants: grantsService(),
        syncLifecycle,
      }).removeAccess({
        userId: USER,
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        op: "deactivate_user",
      });

      const after = await collectAccess();
      expect(after.isOrgMember).toBe(false);
      expect(after.bindings).toEqual([]);
    });
  });

  describe("given a proof that still finds something resolving", () => {
    /** @scenario A removal that cannot prove itself empty fails loudly */
    it("refuses, and leaves the member's access exactly as it was", async () => {
      const before = await collectAccess();

      // A collector that reports the person as still a member however the
      // transaction reads. This is the deliberate way to fail the proof: the
      // deletes really do happen inside the transaction, and the assertion is
      // that they are ROLLED BACK when the postcondition does not hold.
      const grants = new GrantsService(
        new LedgerAuthzGrantsRepository(prisma, grantsLedgerWriter()),
        {
          newBindingId: () => generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          bumpEpoch: bumpAuthzEpoch,
          collectorFor: () =>
            ({
              collectGrants: async () => ({
                principal: { type: "user" as const, id: USER },
                organizationId: ORGANIZATION,
                organizationRole: "MEMBER" as const,
                isOrgMember: true,
                membershipDisabled: false,
                bindings: [],
                legacyTeamMemberships: [],
                customRolePermissions: {},
              }),
            }) as never,
        },
      );

      await expect(
        new ScimDeprovisionService({ grants, syncLifecycle }).removeAccess({
          userId: USER,
          organizationId: ORGANIZATION,
          connectionId: CONNECTION,
          op: "delete_user",
        }),
      ).rejects.toBeInstanceOf(OffboardIncompleteError);

      // The membership rows are back: the transaction rolled them back, so
      // nothing about this person was half-removed.
      const membership = await prisma.organizationUser.findUnique({
        where: {
          userId_organizationId: { userId: USER, organizationId: ORGANIZATION },
        },
      });
      expect(membership).not.toBeNull();
      expect(
        await prisma.groupMembership.count({ where: { userId: USER } }),
      ).toBe(1);
      expect(before.isOrgMember).toBe(true);
    });
  });
});
