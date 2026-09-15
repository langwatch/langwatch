// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 *
 * @see specs/identity/scim-connection-sync.feature
 * @see dev/docs/identity-platform/D09-auth0-customer-migrations.md
 *
 * The route is the security boundary for a directory credential. These tests
 * use real token rows, the real middleware and persisted directory ownership
 * to prove that one side of a legal legacy-to-direct migration pair cannot
 * mutate the other side's people or groups. They also pin the point at which
 * the grandfathered directory is retired: FINALIZING, before teardown has
 * necessarily removed its token.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { ENTERPRISE_TEST_PLAN } from "~/test-utils/managementApiOrg";
import { app } from "../routes";
import { ScimTokenService } from "../scim-token.service";

const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

type Pair = {
  organizationId: string;
  legacyConnectionId: string;
  directConnectionId: string;
};

describe("Feature: SCIM route writes stay inside their connection", () => {
  const ns = `scim-route-isolation-${nanoid(8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  let first: Pair;
  let second: Pair;
  let legacyToken: string;
  let directToken: string;
  let legacyUserId: string;
  let directUserId: string;
  let secondDirectUserId: string;
  let directGroupId: string;

  beforeAll(async () => {
    await resetApp();
    const getActivePlan = vi.fn().mockResolvedValue(ENTERPRISE_TEST_PLAN);
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: getActivePlan as PlanProvider["getActivePlan"],
      }),
    });

    first = await seedMigrationPair("first");
    second = await seedMigrationPair("second");

    legacyUserId = await seedDirectoryUser({
      pair: first,
      connectionId: first.legacyConnectionId,
      label: "legacy-owner",
    });
    directUserId = await seedDirectoryUser({
      pair: first,
      connectionId: first.directConnectionId,
      label: "direct-owner",
    });
    directGroupId = await seedDirectoryGroup({
      pair: first,
      connectionId: first.directConnectionId,
      userId: directUserId,
    });

    const mintedLegacy = await ScimTokenService.create(prisma).generate({
      organizationId: first.organizationId,
      connectionId: first.legacyConnectionId,
      description: "legacy route isolation",
    });
    legacyToken = mintedLegacy.token;

    secondDirectUserId = await seedDirectoryUser({
      pair: second,
      connectionId: second.directConnectionId,
      label: "discarded-direct-owner",
    });
    const mintedDirect = await ScimTokenService.create(prisma).generate({
      organizationId: second.organizationId,
      connectionId: second.directConnectionId,
      description: "discarded direct route isolation",
    });
    directToken = mintedDirect.token;
  });

  afterAll(async () => {
    try {
      await cleanupTestRows(prisma, [
        ["scimRequestLog", { organizationId: { in: organizationIds } }],
        ["scimToken", { organizationId: { in: organizationIds } }],
        ["scimExternalId", { userId: { in: userIds } }],
        ["groupMembership", { userId: { in: userIds } }],
        ["roleBinding", { organizationId: { in: organizationIds } }],
        ["group", { organizationId: { in: organizationIds } }],
        ["organizationUser", { organizationId: { in: organizationIds } }],
        ["user", { id: { in: userIds } }],
        ["scimSyncState", { organizationId: { in: organizationIds } }],
        ["ssoConnection", { organizationId: { in: organizationIds } }],
        ["organization", { id: { in: organizationIds } }],
      ]);
    } finally {
      await resetApp();
    }
  });

  describe("given a grandfathered token and resources owned by its direct sibling", () => {
    it("refuses user PATCH and leaves every persisted authority row unchanged", async () => {
      const before = await authoritySnapshot(first.organizationId);

      const response = await requestWithToken({
        token: legacyToken,
        path: `/api/scim/v2/Users/${directUserId}`,
        method: "PATCH",
        body: patch([
          { op: "replace", value: { name: { givenName: "Taken" } } },
        ]),
      });

      expect(await readForbiddenResponse(response)).toMatchObject({
        status: 403,
        contentType: expect.stringContaining("application/scim+json"),
        body: { schemas: [SCIM_ERROR_SCHEMA], status: "403" },
      });
      expect(await authoritySnapshot(first.organizationId)).toEqual(before);
    });

    it("refuses user DELETE and leaves every persisted authority row unchanged", async () => {
      const before = await authoritySnapshot(first.organizationId);

      const response = await requestWithToken({
        token: legacyToken,
        path: `/api/scim/v2/Users/${directUserId}`,
        method: "DELETE",
      });

      expect(await readForbiddenResponse(response)).toMatchObject({
        status: 403,
        contentType: expect.stringContaining("application/scim+json"),
        body: { schemas: [SCIM_ERROR_SCHEMA], status: "403" },
      });
      expect(await authoritySnapshot(first.organizationId)).toEqual(before);
    });

    it("refuses group membership PATCH and leaves membership and grants unchanged", async () => {
      const before = await authoritySnapshot(first.organizationId);

      const response = await requestWithToken({
        token: legacyToken,
        path: `/api/scim/v2/Groups/${directGroupId}`,
        method: "PATCH",
        body: patch([
          {
            op: "replace",
            path: "members",
            value: [{ value: legacyUserId }],
          },
        ]),
      });

      expect(await readForbiddenResponse(response)).toMatchObject({
        status: 403,
        contentType: expect.stringContaining("application/scim+json"),
        body: { schemas: [SCIM_ERROR_SCHEMA], status: "403" },
      });
      expect(await authoritySnapshot(first.organizationId)).toEqual(before);
    });
  });

  it("refuses a token from another organization without mutating either tenant", async () => {
    const firstBefore = await authoritySnapshot(first.organizationId);
    const secondBefore = await authoritySnapshot(second.organizationId);

    const response = await requestWithToken({
      token: legacyToken,
      path: `/api/scim/v2/Users/${secondDirectUserId}`,
      method: "DELETE",
    });

    expect(response.status).toBe(404);
    expect(await authoritySnapshot(first.organizationId)).toEqual(firstBefore);
    expect(await authoritySnapshot(second.organizationId)).toEqual(
      secondBefore,
    );
  });

  describe("given the grandfathered connection is still serving its own directory", () => {
    it("allows an own-resource mutation during active grace", async () => {
      await clearTokenUse(first.legacyConnectionId);
      const otherOrganizationBefore = await authoritySnapshot(
        second.organizationId,
      );
      const response = await requestWithToken({
        token: legacyToken,
        path: `/api/scim/v2/Users/${legacyUserId}`,
        method: "PATCH",
        body: patch([
          {
            op: "replace",
            value: { name: { givenName: "Still", familyName: "Serving" } },
          },
        ]),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        id: legacyUserId,
        name: { givenName: "Still", familyName: "Serving" },
      });
      await expect(
        prisma.user.findUniqueOrThrow({
          where: { id: legacyUserId },
          select: { name: true },
        }),
      ).resolves.toEqual({ name: "Still Serving" });
      expect(await authoritySnapshot(second.organizationId)).toEqual(
        otherOrganizationBefore,
      );
      expect(await tokenLastUsedAt(first.legacyConnectionId)).not.toBeNull();
    });
  });

  describe.each([
    "FINALIZING",
    "FINALIZED",
  ] as const)("given the direct replacement is %s", (migrationPhase) => {
    it("refuses the legacy token before recording it as used", async () => {
      await prisma.ssoConnection.update({
        where: { id: first.directConnectionId },
        data: { migrationPhase },
      });
      await clearTokenUse(first.legacyConnectionId);
      const before = await authoritySnapshot(first.organizationId);

      const response = await requestWithToken({
        token: legacyToken,
        path: `/api/scim/v2/Users/${legacyUserId}`,
        method: "DELETE",
      });

      expect(await readForbiddenResponse(response)).toMatchObject({
        status: 403,
        contentType: expect.stringContaining("application/scim+json"),
        body: { schemas: [SCIM_ERROR_SCHEMA], status: "403" },
      });
      expect(await authoritySnapshot(first.organizationId)).toEqual(before);
      expect(await tokenLastUsedAt(first.legacyConnectionId)).toBeNull();
    });
  });

  it("refuses a TORN_DOWN connection's own token without recording it as used", async () => {
    await prisma.ssoConnection.update({
      where: { id: first.directConnectionId },
      data: { migrationPhase: "GRACE_LEGACY" },
    });
    await prisma.ssoConnection.update({
      where: { id: first.legacyConnectionId },
      data: { state: "TORN_DOWN" },
    });
    await clearTokenUse(first.legacyConnectionId);
    const before = await authoritySnapshot(first.organizationId);

    const response = await requestWithToken({
      token: legacyToken,
      path: `/api/scim/v2/Users/${legacyUserId}`,
      method: "DELETE",
    });

    expect(await readForbiddenResponse(response)).toMatchObject({
      status: 403,
      contentType: expect.stringContaining("application/scim+json"),
      body: { schemas: [SCIM_ERROR_SCHEMA], status: "403" },
    });
    expect(await authoritySnapshot(first.organizationId)).toEqual(before);
    expect(await tokenLastUsedAt(first.legacyConnectionId)).toBeNull();
  });

  it("refuses a DISCARDED connection's own token without recording it as used", async () => {
    await prisma.ssoConnection.update({
      where: { id: second.directConnectionId },
      data: { state: "DISCARDED" },
    });
    await clearTokenUse(second.directConnectionId);
    const before = await authoritySnapshot(second.organizationId);

    const response = await requestWithToken({
      token: directToken,
      path: `/api/scim/v2/Users/${secondDirectUserId}`,
      method: "DELETE",
    });

    expect(await readForbiddenResponse(response)).toMatchObject({
      status: 403,
      contentType: expect.stringContaining("application/scim+json"),
      body: { schemas: [SCIM_ERROR_SCHEMA], status: "403" },
    });
    expect(await authoritySnapshot(second.organizationId)).toEqual(before);
    expect(await tokenLastUsedAt(second.directConnectionId)).toBeNull();
  });

  async function seedMigrationPair(label: string): Promise<Pair> {
    const organization = await prisma.organization.create({
      data: { name: `SCIM route ${label}`, slug: `--test-${ns}-${label}` },
    });
    organizationIds.push(organization.id);
    const legacyConnectionId = `${ns}-${label}-legacy`;
    const directConnectionId = `${ns}-${label}-direct`;
    const now = new Date();
    const base = {
      organizationId: organization.id,
      type: "oidc",
      state: "ACTIVE",
      claimedDomains: [],
      approvedDomains: [],
      verifiedDomains: [],
      lapsedDomains: [],
      idpMetadata: {},
      occurredAt: now,
      acceptedAt: now,
      projectionVersion: "scim-route-isolation-test",
      createdAt: now,
      updatedAt: now,
    };

    await prisma.ssoConnection.create({
      data: {
        ...base,
        id: legacyConnectionId,
        source: "legacy-grandfathered",
        lastEventId: `${legacyConnectionId}-active`,
      },
    });
    await prisma.ssoConnection.create({
      data: {
        ...base,
        id: directConnectionId,
        source: "self-serve",
        replacesConnectionId: legacyConnectionId,
        migrationPhase: "GRACE_LEGACY",
        lastEventId: `${directConnectionId}-grace`,
      },
    });

    return {
      organizationId: organization.id,
      legacyConnectionId,
      directConnectionId,
    };
  }

  async function seedDirectoryUser({
    pair,
    connectionId,
    label,
  }: {
    pair: Pair;
    connectionId: string;
    label: string;
  }): Promise<string> {
    const user = await prisma.user.create({
      data: {
        id: `${ns}-${label}`,
        email: `${label}-${ns}@example.com`,
        name: label,
      },
    });
    userIds.push(user.id);
    await prisma.organizationUser.create({
      data: {
        organizationId: pair.organizationId,
        userId: user.id,
        role: OrganizationUserRole.MEMBER,
      },
    });
    await prisma.scimExternalId.create({
      data: {
        connectionId,
        externalId: `${connectionId}-${label}`,
        userId: user.id,
      },
    });
    await prisma.roleBinding.create({
      data: {
        id: `${ns}-${label}-grant`,
        organizationId: pair.organizationId,
        userId: user.id,
        role: TeamUserRole.MEMBER,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: pair.organizationId,
      },
    });
    return user.id;
  }

  async function seedDirectoryGroup({
    pair,
    connectionId,
    userId,
  }: {
    pair: Pair;
    connectionId: string;
    userId: string;
  }): Promise<string> {
    const group = await prisma.group.create({
      data: {
        organizationId: pair.organizationId,
        name: "Direct owners",
        slug: `${ns}-direct-owners`,
        externalId: `${ns}-direct-owners-external`,
        scimSource: "okta",
        scimConnectionId: connectionId,
      },
    });
    await prisma.groupMembership.create({
      data: { groupId: group.id, userId },
    });
    await prisma.roleBinding.create({
      data: {
        id: `${ns}-direct-group-grant`,
        organizationId: pair.organizationId,
        groupId: group.id,
        role: TeamUserRole.MEMBER,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: pair.organizationId,
      },
    });
    return group.id;
  }

  async function authoritySnapshot(organizationId: string) {
    const memberships = await prisma.organizationUser.findMany({
      where: { organizationId },
      select: { userId: true, role: true, disabledAt: true },
      orderBy: { userId: "asc" },
    });
    const scopedUserIds = memberships.map(({ userId }) => userId);
    const [users, directoryIds, groups, groupMemberships, grants] =
      await Promise.all([
        prisma.user.findMany({
          where: { id: { in: scopedUserIds } },
          select: {
            id: true,
            email: true,
            name: true,
            deactivatedAt: true,
          },
          orderBy: { id: "asc" },
        }),
        prisma.scimExternalId.findMany({
          where: { userId: { in: scopedUserIds } },
          select: { connectionId: true, externalId: true, userId: true },
          orderBy: [{ connectionId: "asc" }, { externalId: "asc" }],
        }),
        prisma.group.findMany({
          where: { organizationId },
          select: {
            id: true,
            name: true,
            externalId: true,
            scimConnectionId: true,
          },
          orderBy: { id: "asc" },
        }),
        prisma.groupMembership.findMany({
          where: { group: { organizationId } },
          select: { groupId: true, userId: true },
          orderBy: [{ groupId: "asc" }, { userId: "asc" }],
        }),
        prisma.roleBinding.findMany({
          where: { organizationId },
          select: {
            id: true,
            userId: true,
            groupId: true,
            role: true,
            scopeType: true,
            scopeId: true,
          },
          orderBy: { id: "asc" },
        }),
      ]);

    return {
      users,
      memberships,
      directoryIds,
      groups,
      groupMemberships,
      grants,
    };
  }

  function patch(Operations: unknown[]) {
    return { schemas: [PATCH_SCHEMA], Operations };
  }

  async function requestWithToken({
    token,
    path,
    method,
    body,
  }: {
    token: string;
    path: string;
    method: "PATCH" | "DELETE";
    body?: unknown;
  }): Promise<Response> {
    return app.request(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined
          ? {}
          : { "Content-Type": "application/scim+json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function readForbiddenResponse(response: Response): Promise<{
    status: number;
    contentType: string | null;
    body: unknown;
  }> {
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      body: await response.json(),
    };
  }

  async function clearTokenUse(connectionId: string): Promise<void> {
    await prisma.scimToken.updateMany({
      where: { connectionId },
      data: { lastUsedAt: null },
    });
  }

  async function tokenLastUsedAt(connectionId: string): Promise<Date | null> {
    const token = await prisma.scimToken.findFirstOrThrow({
      where: { connectionId },
      select: { lastUsedAt: true },
    });
    return token.lastUsedAt;
  }
});
