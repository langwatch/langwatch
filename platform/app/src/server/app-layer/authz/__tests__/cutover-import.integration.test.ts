/**
 * @vitest-environment node
 *
 * ADR-092 §13, delivery-plan PR 3: the facts that never had a binding row.
 *
 * A legacy organization's access is not all in `RoleBinding`. Some of it is a
 * column on a membership row, some of it is a share link, some of it is an
 * email address in an environment variable. None of those survive the ledger
 * becoming the only writer unless the cutover states them as facts first - and
 * each one has to arrive carrying the business time of the row it came from,
 * or a replay reorders history.
 *
 * So this suite seeds one of each and runs the whole pass against a real
 * Postgres, then reads the grant head. The zero-binding admin arrives from the
 * genesis import in the same pass, which is why it is asserted here as an
 * output of the pass rather than of one migration inside it.
 *
 * @see specs/rbac/in-place-authz-migration.feature
 */
import { GRANTS_CUTOVER_MIGRATION_NAME } from "@langwatch/authz-server/migration";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GrantPrincipalType,
  GrantScopeType,
  type Organization,
  OrganizationUserRole,
  type Project,
  ShareResourceType,
  ShareVisibility,
  type Team,
} from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import {
  cutoverMigrations,
  inlineGrantsLedger,
  runMigrationPassForTenant,
} from "./cutover-pass.harness";

const ns = `authz-cutover-import-${nanoid(8)}`;

/** Fixed business times, so "carries the row's own time" is checkable. */
const MEMBERSHIP_AT = new Date("2024-03-01T09:00:00.000Z");
const SHARE_LINK_AT = new Date("2024-05-17T13:45:00.000Z");
const PROJECT_AT = new Date("2024-01-09T07:30:00.000Z");
const SHARE_EXPIRES_AT = new Date("2026-12-31T23:59:00.000Z");

const MAX_PASSES = 3;

describe("given an organization whose legacy facts live outside its bindings", () => {
  const ledger = inlineGrantsLedger(prisma);

  let organization: Organization;
  let team: Team;
  let project: Project;
  let adminUserId: string;
  let shareLinkId: string;

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: "Cutover Import Org", slug: `--test-org-${ns}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Cutover Import Team",
        slug: `--test-team-${ns}`,
        organizationId: organization.id,
      },
    });
    project = await prisma.project.create({
      data: {
        name: "Cutover Import Project",
        slug: `--test-project-${ns}`,
        apiKey: `--test-key-${ns}`,
        teamId: team.id,
        language: "python",
        framework: "openai",
        // The legacy per-project credential's business time: `Project.apiKey`
        // is a fact of its own, and the import backdates it to this.
        createdAt: PROJECT_AT,
      },
    });

    // The admin whose only record of being an admin is the membership row's
    // role column - no binding anywhere.
    const admin = await prisma.user.create({
      data: { name: "Legacy Admin", email: `admin-${ns}@example.com` },
    });
    adminUserId = admin.id;
    await prisma.organizationUser.create({
      data: {
        userId: adminUserId,
        organizationId: organization.id,
        role: OrganizationUserRole.ADMIN,
        createdAt: MEMBERSHIP_AT,
      },
    });

    // The share link, with the terms a customer is holding: a token, an
    // expiry and a view cap.
    const shareLink = await prisma.shareLink.create({
      data: {
        token: `--test-share-token-${ns}`,
        resourceType: ShareResourceType.TRACE,
        resourceId: `trace_${ns}`,
        projectId: project.id,
        userId: adminUserId,
        visibility: ShareVisibility.PUBLIC,
        expiresAt: SHARE_EXPIRES_AT,
        maxViews: 5,
        createdAt: SHARE_LINK_AT,
      },
    });
    shareLinkId = shareLink.id;

    const migrations = cutoverMigrations({
      prisma,
      ledger: ledger.emitter,
      cutoverCohort: (tenantId) => tenantId === organization.id,
    });
    // A silent exit from this loop leaves every assertion below failing on
    // a missing grant, which reads as "the import did not state the fact"
    // when the truth is usually that the pass was still waiting on
    // something. So the loop names what blocked it.
    let lastReport: unknown = null;
    let finalized = false;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      await runMigrationPassForTenant({
        prisma,
        organizationId: organization.id,
        migrations,
      });
      const record = await prisma.systemMigrationTenantState.findUnique({
        where: {
          migrationName_tenantId: {
            migrationName: GRANTS_CUTOVER_MIGRATION_NAME,
            tenantId: organization.id,
          },
        },
      });
      lastReport = record?.report ?? record?.status ?? null;
      if (record?.status === "finalized") {
        finalized = true;
        break;
      }
    }
    if (!finalized) {
      throw new Error(
        `the cutover pass did not finalize in ${MAX_PASSES} passes; it last reported ${JSON.stringify(
          lastReport,
        )}`,
      );
    }
  });

  afterAll(async () => {
    if (!organization?.id) return;
    // Every sibling fixture guards itself: a `beforeAll` that failed partway
    // leaves later fixtures undefined, and a TypeError here would bury the
    // failure that actually broke the suite.
    const userIds = [adminUserId].filter(
      (id): id is string => typeof id === "string",
    );
    await cleanupTestRows(prisma, [
      ["grantUsage", { organizationId: organization.id }],
      ...(project?.id
        ? ([["shareLink", { projectId: project.id }]] as const)
        : []),
      ["grant", { organizationId: organization.id }],
      ["role", { organizationId: organization.id }],
      ["roleBinding", { organizationId: organization.id }],
      ["customRole", { organizationId: organization.id }],
      ["authzProjectionCursor", { organizationId: organization.id }],
      ["authzCutoverProjection", { organizationId: organization.id }],
      ["systemMigrationTenantState", { tenantId: organization.id }],
      ["organizationUser", { organizationId: organization.id }],
      ...(project?.id ? ([["project", { id: project.id }]] as const) : []),
      ...(team?.id ? ([["team", { id: team.id }]] as const) : []),
      ...(userIds.length > 0
        ? ([["user", { id: { in: userIds } }]] as const)
        : []),
      ["organization", { id: organization.id }],
    ]);
  });

  /** @scenario "Cutover imports the legacy facts that only exist outside bindings" */
  it("states each of them as a grant carrying its source row's business time", async () => {
    // The zero-binding admin, stated by the genesis import in the same pass.
    // `legacy-admin`, not `admin`: the fact is dormant by vocabulary - the
    // collector translates no binding out of it - so storing it changes no
    // decision until contract gives it the fallback's actual bag.
    const adminGrant = await prisma.grant.findFirst({
      where: {
        organizationId: organization.id,
        principalType: GrantPrincipalType.USER,
        principalId: adminUserId,
        scopeType: GrantScopeType.ORGANIZATION,
        roleKey: "legacy-admin",
      },
    });
    expect(adminGrant).not.toBeNull();
    expect(adminGrant?.occurredAt).toEqual(MEMBERSHIP_AT);

    // The share link, ADOPTED: the grant IS the link's own row id, so the
    // token a customer already circulated keeps resolving to it.
    const resourceGrant = await prisma.grant.findUnique({
      where: { id: shareLinkId },
    });
    expect(resourceGrant).toMatchObject({
      organizationId: organization.id,
      principalType: GrantPrincipalType.ANYONE,
      principalId: null,
      scopeType: GrantScopeType.RESOURCE,
      scopeId: `trace_${ns}`,
      token: `--test-share-token-${ns}`,
      permission: "traces:view",
      resourceKind: "TRACE",
      projectId: project.id,
      createdByUserId: adminUserId,
      maxViews: 5,
      source: "cutover-import",
    });
    expect(resourceGrant?.expiresAt).toEqual(SHARE_EXPIRES_AT);
    expect(resourceGrant?.occurredAt).toEqual(SHARE_LINK_AT);

    // Operator access is the live admin list, never a ledger fact: no
    // platform-scoped cutover grant may exist for anyone, anywhere. The
    // tenancy guard (rightly) refuses an org-unkeyed Grant query from app
    // code, so this fleet-wide invariant reads the table raw - the one
    // reader with a legitimate claim to every organization's rows at once.
    const strayPlatformGrants = await prisma.$queryRaw<
      Array<{ count: bigint }>
    >`-- @tenancy: fleet invariant - platform-scoped cutover grants may exist for no organization
      SELECT COUNT(*)::bigint AS count FROM "Grant"
      WHERE source = 'cutover-import' AND "scopeType" = 'PLATFORM'`;
    expect(Number(strayPlatformGrants[0]?.count ?? -1)).toBe(0);

    // Nothing the import stated carries the time it was stated. The
    // organization's two imported facts - the share link and the project's
    // legacy credential - are backdated to their own rows, which is what makes
    // a replay reproduce history rather than the migration's own afternoon.
    const imported = await prisma.grant.findMany({
      where: { organizationId: organization.id, source: "cutover-import" },
      orderBy: { occurredAt: "asc" },
    });
    expect(imported.map((grant) => grant.occurredAt)).toEqual([
      PROJECT_AT,
      SHARE_LINK_AT,
    ]);
  });
});
