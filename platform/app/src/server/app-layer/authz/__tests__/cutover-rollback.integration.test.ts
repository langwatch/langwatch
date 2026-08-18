/**
 * @vitest-environment node
 *
 * ADR-092 §13 decision 7, delivery-plan PR 3: rolling a cutover back is the
 * emergency lever, so it is the one write that may not depend on anything
 * being up. The operator presses it because the engine is deciding wrongly for
 * a customer RIGHT NOW - which is exactly the moment the queue is least likely
 * to be draining.
 *
 * So the queue leg is severed the way
 * `ledger-instant-revoke.integration.test.ts` severs it: the
 * `cutover_rolled_back` command is captured and no fold can ever run, and the
 * Redis handle the epoch bump reaches for has been disconnected. What is left
 * is the synchronous enforcement write, and the only way the projection can
 * read `onEngine = false` when `rollBack` resolves is that the call made it so
 * itself.
 *
 * Then the request path is asked. The organization's only record of this
 * user's access is a grant head fact, so the engine permits and legacy denies;
 * once the gate's cache is dropped, a denied check is proof the fork stopped
 * consulting the engine.
 *
 * @see specs/rbac/in-place-authz-migration.feature
 */
import { GRANTS_CUTOVER_MIGRATION_NAME } from "@langwatch/authz-server/migration";
import { RedisConnectionService } from "@langwatch/redis-client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GrantPrincipalType,
  GrantScopeType,
  type Organization,
  OrganizationUserRole,
  type Project,
  type Team,
} from "~/generated/prisma/client";
import { resolveProjectPermission } from "~/server/api/rbac";
import { type App, globalForApp } from "~/server/app-layer/app";
import type { Session } from "~/server/auth";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { PrismaSystemMigrationStateRepository } from "../../system-migrations/repositories/system-migration-state.prisma.repository";
import { SystemMigrationsService } from "../../system-migrations/system-migrations.service";
import { resetCutoverGateForTesting } from "../cutover-gate";
import { bumpAuthzEpoch } from "../epoch";
import { PrismaAuthzGrantsProjectionRepository } from "../repositories/authz-grants-projection.prisma.repository";

const ns = `authz-cutover-rollback-${nanoid(8)}`;

const OPERATOR_ID = `user_operator_${nanoid(6)}`;

describe("given a cut-over organization rolled back with the queue stopped", () => {
  const appended: Array<{ organizationId: string; actorUserId: string }> = [];

  let organization: Organization;
  let team: Team;
  let project: Project;
  let userId: string;
  let previousApp: App | null = null;
  let grantId: string;

  const session = () => ({ user: { id: userId } }) as unknown as Session;

  /**
   * `system-migrations/runtime.ts`'s `rollBackAuthzCutover`, with its ledger
   * send captured instead of queued: the fact, then the synchronous
   * projection flip, then the epoch bump. Same order, and the order is the
   * point - the enforcement is what has to hold without the fold.
   */
  const service = () =>
    new SystemMigrationsService({
      state: new PrismaSystemMigrationStateRepository(prisma),
      migrationNames: () => [GRANTS_CUTOVER_MIGRATION_NAME],
      runPass: async () => null,
      rollbackEffects: {
        [GRANTS_CUTOVER_MIGRATION_NAME]: async ({ tenantId, actorUserId }) => {
          appended.push({ organizationId: tenantId, actorUserId });
          await new PrismaAuthzGrantsProjectionRepository(
            prisma,
          ).enforceCutoverRollback({ organizationId: tenantId });
          await bumpAuthzEpoch({ organizationId: tenantId });
        },
      },
    });

  beforeAll(async () => {
    // A real connection, then closed: the epoch bump genuinely tries Redis
    // and genuinely fails, which is the outage this scenario is about.
    const connection = new RedisConnectionService().connect({
      url: process.env.REDIS_URL,
      clusterEndpoints: process.env.REDIS_CLUSTER_ENDPOINTS,
      dbIndex: process.env.REDIS_DB_INDEX,
    });
    if (!connection) {
      throw new Error(
        "This suite needs Redis. Set LANGWATCH_TEST_REDIS_URL in platform/app/.env.",
      );
    }
    connection.disconnect();
    previousApp = globalForApp.__langwatch_app;
    globalForApp.__langwatch_app = { redis: connection } as unknown as App;

    organization = await prisma.organization.create({
      data: { name: "Cutover Rollback Org", slug: `--test-org-${ns}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Cutover Rollback Team",
        slug: `--test-team-${ns}`,
        organizationId: organization.id,
      },
    });
    project = await prisma.project.create({
      data: {
        name: "Cutover Rollback Project",
        slug: `--test-project-${ns}`,
        apiKey: `--test-key-${ns}`,
        teamId: team.id,
        language: "python",
        framework: "openai",
      },
    });
    const user = await prisma.user.create({
      data: { name: "Rolled Back Member", email: `${ns}@example.com` },
    });
    userId = user.id;
    await prisma.organizationUser.create({
      data: {
        userId,
        organizationId: organization.id,
        role: OrganizationUserRole.MEMBER,
      },
    });

    // The organization as a finished cutover pass leaves it: finalized state,
    // the projection on the engine, and a PROJECT-scoped admin fact on the
    // grant head with no compat binding row behind it.
    await prisma.systemMigrationTenantState.create({
      data: {
        migrationName: GRANTS_CUTOVER_MIGRATION_NAME,
        tenantId: organization.id,
        status: "finalized",
      },
    });
    await prisma.authzCutoverProjection.create({
      data: { organizationId: organization.id, onEngine: true },
    });
    grantId = `grant_${ns}_engine_only`;
    await prisma.grant.create({
      data: {
        id: grantId,
        organizationId: organization.id,
        principalType: GrantPrincipalType.USER,
        principalId: userId,
        roleKey: "admin",
        source: "grants-service",
        scopeType: GrantScopeType.PROJECT,
        scopeId: project.id,
        occurredAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    globalForApp.__langwatch_app = previousApp;
    if (!organization?.id) return;
    await cleanupTestRows(prisma, [
      ["grant", { organizationId: organization.id }],
      ["roleBinding", { organizationId: organization.id }],
      ["authzCutoverProjection", { organizationId: organization.id }],
      ["systemMigrationTenantState", { tenantId: organization.id }],
      ["organizationUser", { organizationId: organization.id }],
      ["project", { id: project.id }],
      ["team", { id: team.id }],
      ...(userId ? ([["user", { id: userId }]] as const) : []),
      ["organization", { id: organization.id }],
    ]);
  });

  /** @scenario "Rolling back a cutover takes effect without a deploy, even with the queue stopped" */
  it("has pinned the organization and flipped the projection before the call returns", async () => {
    // Without this the assertions below would pass just as happily against a
    // seed that never landed.
    resetCutoverGateForTesting();
    expect(
      await resolveProjectPermission(
        { prisma, session: session() },
        project.id,
        "project:delete",
      ),
    ).toEqual({ permitted: true, organizationRole: "MEMBER" });
    await new Promise((resolve) => setImmediate(resolve));

    await service().rollBack({
      migrationName: GRANTS_CUTOVER_MIGRATION_NAME,
      tenantId: organization.id,
      actorUserId: OPERATOR_ID,
    });

    // The fact was stated, and nothing folded it: whatever flipped the
    // projection below was this call.
    expect(appended).toEqual([
      { organizationId: organization.id, actorUserId: OPERATOR_ID },
    ]);
    expect(
      await prisma.authzProjectionCursor.count({
        where: { organizationId: organization.id },
      }),
    ).toBe(0);

    const record = await prisma.systemMigrationTenantState.findUnique({
      where: {
        migrationName_tenantId: {
          migrationName: GRANTS_CUTOVER_MIGRATION_NAME,
          tenantId: organization.id,
        },
      },
    });
    expect(record?.status).toBe("rolled_back");
    expect(
      (
        await prisma.authzCutoverProjection.findUnique({
          where: { organizationId: organization.id },
        })
      )?.onEngine,
    ).toBe(false);

    // The gate's cache window, dropped: what a pod holding a positive answer
    // does within sixty seconds of the flip, done now.
    resetCutoverGateForTesting();

    const decision = await resolveProjectPermission(
      { prisma, session: session() },
      project.id,
      "project:delete",
    );

    // Legacy has no binding row granting this, and legacy is answering again.
    expect(decision).toEqual({ permitted: false, organizationRole: "MEMBER" });
    await new Promise((resolve) => setImmediate(resolve));
  });
});
