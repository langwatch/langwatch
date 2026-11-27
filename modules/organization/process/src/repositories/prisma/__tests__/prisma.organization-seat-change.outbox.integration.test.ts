/**
 * @vitest-environment node
 * @see modules/organization/specs/seat-peak.feature
 * Every organization write that takes or gives back a seat leaves one seat change in the outbox,
 * committed with the write (ADR-002); a rollback leaves none.
 */
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { OrganizationUserRole, type PrismaClient } from "@langwatch/prisma-client/generated";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { recordSeatChangedCommandDataSchema } from "../../../eventing/seat-peak.events.ts";
import { emptySeatPeak, foldSeatPeak, type SeatPeakFact } from "../../../rules/seat-peak.rules.ts";
import { PrismaOrganizationInviteRepository } from "../prisma.organization-invite.repository.ts";
import { PrismaOrganizationMembershipRepository } from "../prisma.organization-membership.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

class RolledBack extends Error {}

describe.skipIf(!DB_URL)("organization's seat changes (Postgres)", () => {
  const ns = `seat-peak-${nanoid(8).toLowerCase()}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:seat-change-outbox"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const invites = PrismaOrganizationInviteRepository.create({ database: prisma });
  const members = PrismaOrganizationMembershipRepository.create({
    database: prisma,
    cipher: { encrypt: (value: string) => value, decrypt: (value: string) => value },
    grants: createApiFixture<AuthzGrantsService>({
      attachBindings: async () => ({ attached: [], duplicates: [] }),
      revokeBindings: async () => undefined,
      revokeBindingsWhere: async () => 0,
      changeBindingRole: async () => undefined,
    }),
  });
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  let adminUserId: string;

  async function person(label: string): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `${label}-${nanoid(6)}-${ns}@acme.test`, name: label },
    });
    userIds.push(user.id);
    return user.id;
  }

  /** An organization with one active admin, so no change here trips the last-admin guards. */
  async function organization(label: string): Promise<string> {
    const created = await prisma.organization.create({
      data: { name: label, slug: `--${ns}-${label}-${nanoid(4).toLowerCase()}` },
    });
    organizationIds.push(created.id);
    await prisma.organizationUser.create({
      data: { organizationId: created.id, userId: adminUserId, role: OrganizationUserRole.ADMIN },
    });
    return created.id;
  }

  async function seatChanges(organizationId: string) {
    const rows = await prisma.processManagerOutbox.findMany({
      where: { processName: "organizationSeatPeak", projectId: organizationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => ({ intentType: row.intentType, ...(row.payload as object) }));
  }

  function invite(organizationId: string, role = OrganizationUserRole.MEMBER) {
    return invites.createPendingInvite({
      email: `invitee-${nanoid(6)}@acme.test`,
      inviteCode: nanoid(16),
      expiration: nowInstant().add({ milliseconds: FOURTEEN_DAYS_MS }),
      organizationId,
      teamIds: "",
      role,
      requestedBy: adminUserId,
    });
  }

  async function memberOn(organizationId: string, role: OrganizationUserRole): Promise<string> {
    const userId = await person("member");
    await prisma.organizationUser.create({ data: { organizationId, userId, role } });
    return userId;
  }

  beforeAll(async () => {
    adminUserId = await person("admin");
  });

  afterAll(async () => {
    const inOrganizations = { in: organizationIds };
    await prisma.processManagerOutbox.deleteMany({ where: { projectId: inOrganizations } });
    await prisma.auditLog.deleteMany({ where: { organizationId: inOrganizations } });
    await prisma.organizationInvite.deleteMany({ where: { organizationId: inOrganizations } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: inOrganizations } });
    await prisma.team.deleteMany({ where: { organizationId: inOrganizations } });
    await prisma.organization.deleteMany({ where: { id: inOrganizations } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  describe("given an admin who invites somebody to a full seat", () => {
    /** @scenario "A seat taken on any path is counted" */
    it("records the pending invitation taking a full seat until it expires", async () => {
      const organizationId = await organization("invited");
      const created = await invite(organizationId);

      expect(await seatChanges(organizationId)).toEqual([
        expect.objectContaining({
          intentType: "recordSeatChanged",
          tenantId: organizationId,
          organizationId,
          holder: {
            kind: "invitation",
            inviteId: created.id,
            expiresAt: created.expiration?.epochMilliseconds,
          },
          from: "none",
          to: "full",
          cause: "invited",
          actorUserId: adminUserId,
          changeId: expect.any(String),
          occurredAt: expect.any(Number),
        }),
      ]);
    });

    /** @scenario "A seat given back on any path lowers the running count" */
    it("records the revoked invitation giving its seat back", async () => {
      const organizationId = await organization("revoked");
      const created = await invite(organizationId);

      await invites.revokeOpenInvite({ inviteId: created.id, organizationId });

      const changes = await seatChanges(organizationId);
      expect(changes).toHaveLength(2);
      expect(changes[1]).toMatchObject({ from: "full", to: "none", cause: "invitation_revoked" });
    });

    it("records an extended invitation keeping its seat with its new expiry", async () => {
      const organizationId = await organization("extended");
      const created = await invite(organizationId);
      const extended = nowInstant().add({ milliseconds: 2 * FOURTEEN_DAYS_MS });

      await invites.extendInviteExpiration({
        inviteId: created.id,
        organizationId,
        expiration: extended,
      });

      const changes = await seatChanges(organizationId);
      expect(changes).toHaveLength(2);
      expect(changes[1]).toMatchObject({
        holder: { kind: "invitation", inviteId: created.id, expiresAt: extended.epochMilliseconds },
        from: "full",
        to: "full",
        cause: "invited",
      });
    });

    it("records the invitation and the member separately when it is accepted", async () => {
      const organizationId = await organization("accepted");
      const created = await invite(organizationId);
      const userId = await person("invitee");

      await invites.withTransaction(async (transaction) => {
        await transaction.claimInviteForAcceptance({
          inviteId: created.id,
          organizationId,
          inviteCode: created.inviteCode,
          acceptedByUserId: userId,
          acceptedViaIdentifierId: null,
        });
        await transaction.addMembership({
          userId,
          organizationId,
          role: OrganizationUserRole.MEMBER,
          admission: { inviteId: created.id, actorUserId: adminUserId },
        });
      });

      const changes = await seatChanges(organizationId);
      expect(changes.slice(1)).toEqual([
        expect.objectContaining({
          holder: expect.objectContaining({ kind: "invitation", inviteId: created.id }),
          from: "full",
          to: "none",
          cause: "invitation_accepted",
        }),
        expect.objectContaining({
          holder: { kind: "member", userId },
          from: "none",
          to: "full",
          cause: "invitation_accepted",
        }),
      ]);
    });
  });

  describe("given a payment-pending invitation", () => {
    /** @scenario "A seat taken on any path is counted" */
    it("records nothing while it waits and a full seat once payment approves it", async () => {
      const organizationId = await organization("payment");
      const held = await invites.createPaymentPendingInvite({
        email: `paid-${nanoid(6)}@acme.test`,
        inviteCode: nanoid(16),
        expiration: null,
        organizationId,
        teamIds: "",
        role: OrganizationUserRole.MEMBER,
        subscriptionId: `sub-${ns}`,
      });
      expect(await seatChanges(organizationId)).toEqual([]);

      await invites.approvePaymentPendingInvite({
        inviteId: held.id,
        organizationId,
        expiration: nowInstant().add({ milliseconds: FOURTEEN_DAYS_MS }),
      });

      expect(await seatChanges(organizationId)).toEqual([
        expect.objectContaining({ from: "none", to: "full", cause: "payment_approved" }),
      ]);
    });
  });

  describe("given a person admitted without an invitation", () => {
    /** @scenario "A seat taken on any path is counted" */
    it("records the email-domain join taking a full seat", async () => {
      const organizationId = await organization("domain");
      const userId = await person("domain");

      await members.createMembership({
        organizationId,
        userId,
        pendingAdmissionId: `rolebinding_${nanoid(8)}`,
        via: "domain-join",
        seat: "MEMBER",
        pending: false,
      });

      expect(await seatChanges(organizationId)).toEqual([
        expect.objectContaining({
          holder: { kind: "member", userId },
          from: "none",
          to: "full",
          cause: "admitted",
          actorUserId: null,
        }),
      ]);
    });

    /** @scenario "A seat taken on any path is counted" */
    it("records an approved join request under the admin who approved it", async () => {
      const organizationId = await organization("join-request");
      const userId = await person("joiner");

      await members.createMembership({
        organizationId,
        userId,
        pendingAdmissionId: `rolebinding_${nanoid(8)}`,
        via: "join-request-approved",
        seat: "MEMBER",
        pending: false,
        actorUserId: adminUserId,
      });

      expect(await seatChanges(organizationId)).toEqual([
        expect.objectContaining({
          from: "none",
          to: "full",
          cause: "admitted",
          actorUserId: adminUserId,
        }),
      ]);
    });

    /** @scenario "A seat taken on any path is counted" */
    it("records nothing for a held admission and a full seat once it is released", async () => {
      const organizationId = await organization("held");
      const userId = await person("held");

      await members.createMembership({
        organizationId,
        userId,
        pendingAdmissionId: `rolebinding_${nanoid(8)}`,
        via: "sso",
        seat: "MEMBER",
        pending: true,
      });
      expect(await seatChanges(organizationId)).toEqual([]);

      await members.setMemberDisabled({
        organizationId,
        userId,
        disabled: false,
        actorUserId: adminUserId,
      });

      expect(await seatChanges(organizationId)).toEqual([
        expect.objectContaining({ from: "none", to: "full", cause: "enabled" }),
      ]);
    });

    it("records a Lite Member seat for an arrival on the Lite seat", async () => {
      const organizationId = await organization("lite-arrival");
      const userId = await person("lite");

      await members.createMembership({
        organizationId,
        userId,
        pendingAdmissionId: `rolebinding_${nanoid(8)}`,
        via: "sso",
        seat: "EXTERNAL",
        pending: false,
      });

      expect(await seatChanges(organizationId)).toEqual([
        expect.objectContaining({ from: "none", to: "lite", cause: "admitted" }),
      ]);
    });
  });

  describe("given a full member", () => {
    /** @scenario "A seat given back on any path lowers the running count" */
    it("records disabling them as giving the seat back", async () => {
      const organizationId = await organization("disabled");
      const userId = await memberOn(organizationId, OrganizationUserRole.MEMBER);

      await members.setMemberDisabled({
        organizationId,
        userId,
        disabled: true,
        actorUserId: adminUserId,
      });

      expect(await seatChanges(organizationId)).toEqual([
        expect.objectContaining({
          holder: { kind: "member", userId },
          from: "full",
          to: "none",
          cause: "disabled",
          actorUserId: adminUserId,
        }),
      ]);
    });

    /** @scenario "A seat given back on any path lowers the running count" */
    it("records removing them as giving the seat back", async () => {
      const organizationId = await organization("removed");
      const userId = await memberOn(organizationId, OrganizationUserRole.MEMBER);

      await members.deleteMember({ organizationId, userId, actingUserId: adminUserId });

      expect(await seatChanges(organizationId)).toEqual([
        expect.objectContaining({ from: "full", to: "none", cause: "removed" }),
      ]);
    });

    /** @scenario "A seat given back on any path lowers the running count" */
    it("records moving them to a Lite Member, and back to full", async () => {
      const organizationId = await organization("role");
      const userId = await memberOn(organizationId, OrganizationUserRole.MEMBER);
      const change = (role: OrganizationUserRole) =>
        members.updateMemberRole({
          caller: { type: "system" },
          organizationId,
          userId,
          role,
          effectiveTeamRoleUpdates: [],
          currentUserId: adminUserId,
        });

      await change(OrganizationUserRole.EXTERNAL);
      await change(OrganizationUserRole.MEMBER);

      expect(await seatChanges(organizationId)).toEqual([
        expect.objectContaining({ from: "full", to: "lite", cause: "role_changed" }),
        expect.objectContaining({ from: "lite", to: "full", cause: "role_changed" }),
      ]);
    });

    it("stamps a move down and straight back up apart, so either order folds to the table's seat", async () => {
      const organizationId = await organization("role-bounce");
      const userId = await memberOn(organizationId, OrganizationUserRole.MEMBER);
      const change = (role: OrganizationUserRole) =>
        members.updateMemberRole({
          caller: { type: "system" },
          organizationId,
          userId,
          role,
          effectiveTeamRoleUpdates: [],
          currentUserId: adminUserId,
        });

      await change(OrganizationUserRole.EXTERNAL);
      await change(OrganizationUserRole.MEMBER);
      const [down, up] = (await seatChanges(organizationId)).map((row) =>
        recordSeatChangedCommandDataSchema.parse(row),
      );
      const opening: SeatPeakFact = {
        type: "seat_snapshot_taken",
        data: {
          tenantId: organizationId,
          organizationId,
          holders: [{ holder: { kind: "member", userId }, seat: "full" }],
          occurredAt: (down?.occurredAt ?? 0) - 1,
        },
      };

      expect(up?.occurredAt).toBeGreaterThan(down?.occurredAt ?? Number.POSITIVE_INFINITY);
      for (const order of [
        [down, up],
        [up, down],
      ]) {
        const folded = [
          opening,
          ...order.map((data) => ({ type: "seat_changed", data }) as SeatPeakFact),
        ].reduce((state, fact) => foldSeatPeak({ state, fact }), emptySeatPeak());

        expect(folded.members[userId]?.seat).toBe("full");
      }
    });

    it("records nothing when they are made an admin, as no seat moves", async () => {
      const organizationId = await organization("promoted");
      const userId = await memberOn(organizationId, OrganizationUserRole.MEMBER);

      await members.updateMemberRole({
        caller: { type: "system" },
        organizationId,
        userId,
        role: OrganizationUserRole.ADMIN,
        effectiveTeamRoleUpdates: [],
        currentUserId: adminUserId,
      });

      expect(await seatChanges(organizationId)).toEqual([]);
    });
  });

  describe("given somebody founding an organization", () => {
    /** @scenario "A new organization starts counting from its first admin" */
    it("records the founder taking the organization's first full seat", async () => {
      const founderId = await person("founder");
      const id = `${ns}-${nanoid(6).toLowerCase()}`;
      organizationIds.push(`org-${id}`);

      await members.createAndAssign({
        userId: founderId,
        orgId: `org-${id}`,
        orgName: "ACME",
        orgSlug: `org-${id}`,
        teamId: `team-${id}`,
        teamSlug: `team-${id}`,
        pricingModel: "SEAT_EVENT",
      });

      expect(await seatChanges(`org-${id}`)).toEqual([
        expect.objectContaining({
          holder: { kind: "member", userId: founderId },
          from: "none",
          to: "full",
          cause: "organization_created",
          actorUserId: founderId,
        }),
      ]);
    });
  });

  describe("when the transaction a seat change joined rolls back", () => {
    it("leaves neither the invitation nor its seat change", async () => {
      const organizationId = await organization("rolled-back");

      await expect(
        invites.withTransaction(async (transaction) => {
          await transaction.createPendingInvite({
            email: `rolled-back-${nanoid(6)}@acme.test`,
            inviteCode: nanoid(16),
            expiration: nowInstant().add({ milliseconds: FOURTEEN_DAYS_MS }),
            organizationId,
            teamIds: "",
            role: OrganizationUserRole.MEMBER,
            requestedBy: adminUserId,
          });
          throw new RolledBack("the change after the invitation failed");
        }),
      ).rejects.toBeInstanceOf(RolledBack);

      expect(await prisma.organizationInvite.count({ where: { organizationId } })).toBe(0);
      expect(await seatChanges(organizationId)).toEqual([]);
    });
  });
});
