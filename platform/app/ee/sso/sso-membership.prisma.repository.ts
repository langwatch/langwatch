// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { normalizeIdentifierValue } from "@langwatch/identity";
import { generate } from "@langwatch/ksuid";
import {
  OrganizationUserRole,
  Prisma,
  type PrismaClient,
} from "~/generated/prisma/client";
import { KSUID_RESOURCES } from "~/utils/constants";
import type { PendingSsoAdmission } from "./sso-arrival.service";

/**
 * The `OrganizationUser` rows the two single-sign-on sign-in decisions read
 * and write, and the organization row an auto-join announces itself into.
 *
 * `OrganizationUser` is exempt from the multitenancy middleware's
 * organization guard only through the shapes below — each one names an
 * `organizationId` — which is why "is this person a member" is asked here
 * rather than through a `user._count` detour.
 */
export class PrismaSsoMembershipRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { userId, organizationId },
      select: { userId: true },
    });
    return membership !== null;
  }

  /**
   * Whether this person belongs to any organization at all.
   *
   * THROUGH `Organization`, NOT `OrganizationUser`. This is the one question
   * on this repository that names no organization — it asks about a person
   * across all of them — and `OrganizationUser` keyed only by `userId` is
   * exactly the shape the org-tenancy guard refuses (ADR-021). The refusal
   * is a plain `Error`, so it does not degrade to a handled failure: it came
   * back as a 500 on `identity.myTestArrival` for every signed-in reader,
   * with an all-zero trace id and no log line.
   *
   * And the 500 was not merely noise. `resolveOrglessDestination` routes a
   * test arrival to its own explanatory screen only when this read says so,
   * and the caller cannot tell a query that ERRORED from one that answered
   * "no" — so a successful test sign-in landed on "create your organization",
   * which is the exact outcome that screen exists to prevent.
   *
   * `two-step-account.adapter.ts` and `sign-in-security-adapters.ts` both
   * carry the same fix: ask the organizations, filtered by membership.
   */
  async hasAnyMembership({ userId }: { userId: string }): Promise<boolean> {
    const anyOrganization = await this.prisma.organization.findFirst({
      where: { members: { some: { userId } } },
      select: { id: true },
    });
    return anyOrganization !== null;
  }

  /**
   * Whether this address belongs to the one person the SSO setup exemption is
   * for: the administrator who registered a connection, who is still a member
   * of the organization it belongs to.
   *
   * BOTH HALVES ARE LOAD-BEARING. The address must resolve to `userId` — that
   * is what keeps a colleague's address out of a connection under setup — and
   * `userId` must still be a member here, so a registrant whose membership was
   * revoked stops being able to dial the connection they left behind.
   *
   * Both places an address can live are asked, because the identity work moved
   * the truth to `Identifier` while `User.email` remains a copy for accounts the
   * backfill has not finalized (ADR-101 §5). Asking only one of them would make
   * the setup sign-in work for some administrators and not others.
   *
   * THREE READS RATHER THAN ONE JOIN, and not by preference. `Identifier`
   * carries a bare `userId` with deliberately no foreign key — its DETACHED
   * rows are tombstones that outlive the thing they point at — so there is no
   * Prisma relation from `User` to traverse. This was one query with a nested
   * `user.identifiers.some` filter, which Prisma rejects outright with
   * "Unknown argument `identifiers`": the sign-in threw rather than deciding,
   * and the plugin's own `catch {}` turned that into
   * `SSO_USER_RESOLUTION_FAILED` with the cause discarded. It failed only on
   * this path — a connection whose domain is not live — which is why it
   * survived.
   */
  async findRegistrantAtAddress({
    organizationId,
    userId,
    email,
  }: {
    organizationId: string;
    userId: string;
    email: string;
  }): Promise<boolean> {
    const address = email.trim().toLowerCase();
    if (!address) return false;

    // Membership first: it is the cheaper half and the one that fails for a
    // registrant who has since left, which is the case this guard exists for.
    if (!(await this.findMembership({ userId, organizationId }))) return false;

    const legacyAddress = await this.prisma.user.findFirst({
      where: { id: userId, email: { equals: address, mode: "insensitive" } },
      select: { id: true },
    });
    if (legacyAddress !== null) return true;

    const identifier = await this.prisma.identifier.findFirst({
      where: {
        userId,
        // Folded the way the projection folded it when it was written, which
        // is NFKC as well as lower-case. A hand-rolled `toLowerCase()` here
        // compares unequal to a value the store had already normalized, so a
        // unicode homograph would slip past a match that should have hit.
        value: normalizeIdentifierValue(address),
        // A verified address the person still holds. `verifiedAt` alone would
        // also match a DETACHED tombstone — an address they proved once and
        // have since removed — and letting that through would keep a
        // connection dialable by an address its owner had given up.
        state: { in: ["VERIFIED", "PRIMARY"] },
      },
      select: { id: true },
    });
    return identifier !== null;
  }

  async findBoundMemberIdentity({
    organizationId,
    connectionId,
    accountId,
    email,
  }: {
    organizationId: string;
    connectionId: string;
    accountId: string;
    email: string;
  }): Promise<boolean> {
    const address = email.trim().toLowerCase();
    if (!address || !accountId) return false;

    // `orgMemberships` IS a relation and stays in the join; `identifiers` is
    // not one, for the same reason as `findRegistrantAtAddress` above, so the
    // address half is asked separately. This read is only reached once a
    // domain's proof has LAPSED, which is why it threw for nobody until it
    // threw for somebody.
    const account = await this.prisma.account.findFirst({
      where: {
        provider: connectionId,
        providerAccountId: accountId,
        user: {
          orgMemberships: { some: { organizationId, disabledAt: null } },
        },
      },
      select: { userId: true, user: { select: { email: true } } },
    });
    if (account === null) return false;

    if (account.user.email?.trim().toLowerCase() === address) return true;

    const identifier = await this.prisma.identifier.findFirst({
      where: {
        userId: account.userId,
        value: normalizeIdentifierValue(address),
        state: { in: ["VERIFIED", "PRIMARY"] },
      },
      select: { id: true },
    });
    return identifier !== null;
  }

  /**
   * Makes somebody a MEMBER of an organization.
   *
   * P2002 (unique constraint) on THIS insert means another concurrent OAuth
   * callback or a retry already created this membership, so it is answered as
   * `"already-present"` rather than raised — idempotent success. The catch
   * guards the membership write alone: a P2002 from any other constraint is a
   * real failure and propagates.
   */
  async createMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<"created" | "already-present"> {
    try {
      await this.prisma.organizationUser.create({
        data: {
          userId,
          organizationId,
          role: "MEMBER",
          pendingSsoGrantId: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        },
      });
      return "created";
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return "already-present";
      }
      throw err;
    }
  }

  async findPendingAdmission({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<PendingSsoAdmission | null> {
    const member = await this.prisma.organizationUser.findFirst({
      where: {
        userId,
        organizationId,
        disabledAt: null,
        user: { deactivatedAt: null },
        pendingSsoGrantId: { not: null },
      },
      select: { pendingSsoGrantId: true, createdAt: true },
    });
    if (!member?.pendingSsoGrantId) return null;

    const grant = await this.prisma.grant.findFirst({
      where: {
        id: member.pendingSsoGrantId,
        organizationId,
        principalType: "USER",
        principalId: userId,
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
      },
      select: { revokedAt: true },
    });
    let state: PendingSsoAdmission["state"] = "pending";
    if (grant) state = grant.revokedAt ? "revoked" : "applied";
    return {
      grantId: member.pendingSsoGrantId,
      occurredAtMs: member.createdAt.getTime(),
      state,
    };
  }

  async completeAdmission({
    userId,
    organizationId,
    grantId,
  }: {
    userId: string;
    organizationId: string;
    grantId: string;
  }): Promise<boolean> {
    const updated = await this.prisma.$executeRaw`
      -- @tenancy: organization-scoped atomic SSO admission completion
      UPDATE "OrganizationUser" AS membership
      SET "pendingSsoGrantId" = NULL,
          "updatedAt" = NOW()
      WHERE membership."userId" = ${userId}
        AND membership."organizationId" = ${organizationId}
        AND membership."pendingSsoGrantId" = ${grantId}
        AND membership."disabledAt" IS NULL
        AND EXISTS (
          SELECT 1
          FROM "User" AS user_row
          WHERE user_row."id" = membership."userId"
            AND user_row."deactivatedAt" IS NULL
        )
        AND EXISTS (
          SELECT 1
          FROM "Grant" AS grant_row
          WHERE grant_row."id" = membership."pendingSsoGrantId"
            AND grant_row."organizationId" = membership."organizationId"
            AND grant_row."principalType" = 'USER'
            AND grant_row."principalId" = membership."userId"
            AND grant_row."scopeType" = 'ORGANIZATION'
            AND grant_row."scopeId" = membership."organizationId"
            AND grant_row."revokedAt" IS NULL
            AND (
              grant_row."expiresAt" IS NULL
              OR grant_row."expiresAt" > NOW()
            )
        )
    `;
    return updated === 1;
  }

  async clearPendingAdmission({
    userId,
    organizationId,
    grantId,
  }: {
    userId: string;
    organizationId: string;
    grantId: string;
  }): Promise<boolean> {
    const updated = await this.prisma.$executeRaw`
      -- @tenancy: organization-scoped revoked SSO admission cleanup
      UPDATE "OrganizationUser"
      SET "pendingSsoGrantId" = NULL,
          "updatedAt" = NOW()
      WHERE "userId" = ${userId}
        AND "organizationId" = ${organizationId}
        AND "pendingSsoGrantId" = ${grantId}
    `;
    return updated === 1;
  }

  async findOrganizationForMembership({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ id: string; name: string } | null> {
    return await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    });
  }

  /**
   * Whether this person is a live administrator of this organization, counted.
   *
   * The people `breakGlassCandidates` lists, asked on the write path: a
   * binding that named anybody else would satisfy activation's precondition
   * and open no door. Disabled members are excluded because a seat somebody
   * cannot sign into is not a way back in.
   */
  async countEligibleAdministrator({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<number> {
    return await this.prisma.organizationUser.count({
      where: {
        organizationId,
        userId,
        disabledAt: null,
        role: OrganizationUserRole.ADMIN,
      },
    });
  }
}
