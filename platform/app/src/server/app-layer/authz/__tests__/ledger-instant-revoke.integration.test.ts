/**
 * @vitest-environment node
 *
 * ADR-092 §13 decision 7, the delivery plan's testing doctrine #2: instant
 * revocation.
 *
 * Revocation is the one grant write that cannot wait for the queue. Someone
 * is being locked out NOW, and an infrastructure outage is exactly when that
 * is most likely to be happening - so the guarantee has to hold with the
 * queue leg severed entirely.
 *
 * This suite severs it for real: the append resolves (ClickHouse is the
 * durable part and is waited on), no fold can ever run, and the epoch store
 * points at a Redis handle that has been disconnected, so every Redis touch
 * on the path fails. What is left is the synchronous enforcement write, and
 * the only way both heads can be gone from Postgres when `revokeBindings`
 * resolves is that it made them gone itself.
 *
 * Real Postgres and real Redis on purpose: against a mocked store this would
 * assert that the writer calls a method, which is not the promise. The
 * promise is that the rows are not there.
 *
 * @see specs/rbac/unified-authorization-engine.feature
 */
import { RedisConnectionService } from "@langwatch/redis-client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GrantPrincipalType,
  GrantScopeType,
  type Organization,
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { type App, globalForApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { type AuthzGrantsCommandSenders, GrantsLedgerWriter } from "../ledger";

const ns = `authz-revoke-${nanoid(8)}`;

/** Every command the writer can send, one per entity. */
const COMMAND_VERBS = [
  "attachGrant",
  "changeGrantRole",
  "revokeGrant",
  "defineRole",
  "changeRolePermissions",
  "deleteRole",
] as const;

describe("given a revocation with the queue severed and Redis disconnected", () => {
  const appended: Array<{ verb: string; data: unknown }> = [];

  let organization: Organization;
  let userId: string;
  let revokedGrantId: string;
  let survivingGrantId: string;
  let previousApp: App | null = null;

  /** The grants that still authorize — which, now that a revoke marks its
   *  row rather than deleting it, is the only count that means anything. */
  const liveGrantIds = async () =>
    (
      await prisma.grant.findMany({
        where: { organizationId: organization.id, revokedAt: null },
        select: { id: true },
      })
    ).map((row) => row.id);

  const compatBindingIds = async () =>
    (
      await prisma.roleBinding.findMany({
        where: { organizationId: organization.id },
        select: { id: true },
      })
    ).map((row) => row.id);

  const writer = () =>
    new GrantsLedgerWriter(prisma, {
      // This organization is past its genesis import: the doctrine under
      // test is the ledger revoke path, not the pre-ledger one it forks from.
      onLedgerWrites: async () => true,
      commands: async () => ({
        commands: Object.fromEntries(
          COMMAND_VERBS.map((verb) => [
            verb,
            {
              send: async (data: unknown) => {
                appended.push({ verb, data });
              },
            },
          ]),
        ) as unknown as AuthzGrantsCommandSenders,
      }),
    });

  beforeAll(async () => {
    // A real connection, then closed: the epoch bump on the revoke path
    // genuinely tries Redis and genuinely fails, which is the outage this
    // scenario is about. Nothing on the path may notice.
    const connection = new RedisConnectionService().connect({
      url: process.env.REDIS_URL,
      clusterEndpoints: process.env.REDIS_CLUSTER_ENDPOINTS,
      dbIndex: process.env.REDIS_DB_INDEX,
    });
    if (!connection) {
      throw new Error(
        "This suite needs Redis. Set REDIS_URL (or REDIS_CLUSTER_ENDPOINTS) in platform/app/.env.",
      );
    }
    connection.disconnect();
    previousApp = globalForApp.__langwatch_app;
    globalForApp.__langwatch_app = { redis: connection } as unknown as App;

    organization = await prisma.organization.create({
      data: { name: "Instant Revoke Org", slug: `--test-org-${ns}` },
    });
    const user = await prisma.user.create({
      data: { name: "Revoked User", email: `${ns}@example.com` },
    });
    userId = user.id;
    await prisma.organizationUser.create({
      data: {
        userId,
        organizationId: organization.id,
        role: OrganizationUserRole.MEMBER,
      },
    });

    // The two heads the ledger writes, as a landed fold would have left
    // them: the Grant row and the legacy-shaped compat row sharing its id.
    // The second pair is a different role at the same scope - a neighbour
    // the revoke must not touch.
    revokedGrantId = `grant_${ns}_revoked`;
    survivingGrantId = `grant_${ns}_surviving`;
    for (const [id, roleKey, role] of [
      [revokedGrantId, "member", TeamUserRole.MEMBER],
      [survivingGrantId, "viewer", TeamUserRole.VIEWER],
    ] as const) {
      await prisma.grant.create({
        data: {
          id,
          organizationId: organization.id,
          principalType: GrantPrincipalType.USER,
          principalId: userId,
          roleKey,
          source: "grants-service",
          scopeType: GrantScopeType.ORGANIZATION,
          scopeId: organization.id,
          occurredAt: new Date(),
        },
      });
      await prisma.roleBinding.create({
        data: {
          id,
          organizationId: organization.id,
          userId,
          role,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organization.id,
        },
      });
    }
  });

  afterAll(async () => {
    globalForApp.__langwatch_app = previousApp;
    if (!organization?.id) return;
    await cleanupTestRows(prisma, [
      ["grant", { organizationId: organization.id }],
      ["roleBinding", { organizationId: organization.id }],
      ["organizationUser", { organizationId: organization.id }],
      ...(userId ? ([["user", { id: userId }]] as const) : []),
      ["organization", { id: organization.id }],
    ]);
  });

  /** @scenario "A revocation holds before the revoke call returns, with Redis stopped" */
  it("resolves with both heads already deleted, and leaves the grants it did not name", async () => {
    // Without this the deletion assertions below would pass just as happily
    // against a seed that never landed.
    expect(await liveGrantIds()).toHaveLength(2);
    expect(await compatBindingIds()).toHaveLength(2);

    await writer().revokeBindings({
      organizationId: organization.id,
      bindingIds: [revokedGrantId],
      actor: { type: "user", id: userId },
      reason: "offboarded",
    });

    // The fact was appended first: enforcement is early application of an
    // accepted event, never a mark the log never heard about.
    expect(appended.map((call) => call.verb)).toEqual(["revokeGrant"]);

    // The revoked grant is MARKED, not deleted. A row that disappeared could
    // be resurrected by a redelivered attach; a row that says when it ended
    // cannot.
    const revoked = await prisma.grant.findUnique({
      where: { id: revokedGrantId },
      select: { revokedAt: true, revokedReason: true },
    });
    expect(revoked?.revokedAt).not.toBeNull();
    // The direct write records the bypass vocabulary ("revocation" |
    // "offboard"), not the caller's free-text reason — that one travels on
    // the event and lands when the projection write catches up.
    expect(revoked?.revokedReason).toBe("revocation");

    expect(await liveGrantIds()).toEqual([survivingGrantId]);
  });
});
