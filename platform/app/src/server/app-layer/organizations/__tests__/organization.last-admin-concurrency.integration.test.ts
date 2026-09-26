/**
 * @vitest-environment node
 *
 * @see specs/organizations/organization-members-rest-api.feature
 *
 * The last-admin guard has to survive two canonical offboard runs landing at
 * once. The guard and membership deletion now live in the grants repository,
 * so this test drives that concrete service against real PostgreSQL.
 *
 * Requires: PostgreSQL database (Prisma)
 */

import { AuthzCollectorService, GrantsService } from "@langwatch/authz-server";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrganizationUserRole } from "~/generated/prisma/client";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { bumpAuthzEpoch } from "~/server/app-layer/authz/epoch";
import {
  grantsLedgerWriter,
  resetAuthzGrantsCommandsForTests,
} from "~/server/app-layer/authz/ledger";
import { LedgerAuthzGrantsRepository } from "~/server/app-layer/authz/repositories/authz-grants.ledger.repository";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import { seedRoleBinding } from "~/test-utils/authz-seeds";
import { createAuthzTestEventSourcing } from "~/test-utils/authz-test-event-sourcing";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { KSUID_RESOURCES } from "~/utils/constants";

const ns = `last-admin-${nanoid(8)}`;
const ORGANIZATION = `${ns}-org`;
const actor = { type: "system", name: "organizationService" } as const;

let firstAdminId: string;
let secondAdminId: string;
let service: GrantsService;

beforeAll(async () => {
  await prisma.organization.create({
    data: { id: ORGANIZATION, name: "Last Admin Org", slug: ns },
  });
  const [first, second] = await Promise.all([
    prisma.user.create({
      data: { email: `admin1-${ns}@example.com`, name: "First Admin" },
    }),
    prisma.user.create({
      data: { email: `admin2-${ns}@example.com`, name: "Second Admin" },
    }),
  ]);
  firstAdminId = first.id;
  secondAdminId = second.id;

  await prisma.organizationUser.createMany({
    data: [
      {
        userId: firstAdminId,
        organizationId: ORGANIZATION,
        role: OrganizationUserRole.ADMIN,
      },
      {
        userId: secondAdminId,
        organizationId: ORGANIZATION,
        role: OrganizationUserRole.ADMIN,
      },
    ],
  });
  await seedRoleBinding(prisma, {
    id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
    organizationId: ORGANIZATION,
    userId: firstAdminId,
    role: "ADMIN",
    scopeType: "ORGANIZATION",
    scopeId: ORGANIZATION,
  });
  await seedRoleBinding(prisma, {
    id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
    organizationId: ORGANIZATION,
    userId: secondAdminId,
    role: "ADMIN",
    scopeType: "ORGANIZATION",
    scopeId: ORGANIZATION,
  });

  await resetApp();
  resetAuthzGrantsCommandsForTests();
  globalForApp.__langwatch_app = createTestApp({
    _eventSourcing: createAuthzTestEventSourcing(prisma),
  });
  service = new GrantsService(
    new LedgerAuthzGrantsRepository(prisma, grantsLedgerWriter()),
    {
      newBindingId: () => generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      bumpEpoch: bumpAuthzEpoch,
      collectorFor: (reader) => new AuthzCollectorService(reader),
    },
  );
});

afterAll(async () => {
  await resetApp();
  resetAuthzGrantsCommandsForTests();
  await cleanupTestRows(prisma, [
    ["grant", { organizationId: ORGANIZATION }],
    ["roleBinding", { organizationId: ORGANIZATION }],
    ["organizationUser", { organizationId: ORGANIZATION }],
    ["user", { email: { contains: ns } }],
    ["organization", { id: ORGANIZATION }],
  ]);
});

describe("GrantsService.offboard last-admin concurrency", () => {
  /** @scenario Two admins removed at the same time cannot both succeed */
  it("refuses one of two simultaneous removals and keeps an admin", async () => {
    const outcomes = await Promise.allSettled([
      service.offboard({
        actor,
        organizationId: ORGANIZATION,
        userId: firstAdminId,
      }),
      service.offboard({
        actor,
        organizationId: ORGANIZATION,
        userId: secondAdminId,
      }),
    ]);

    const refused = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === "rejected",
    );
    expect(refused).toHaveLength(1);
    expect(refused[0]!.reason).toMatchObject({
      code: "cannot_remove_last_admin",
    });

    await expect(
      prisma.organizationUser.count({
        where: {
          organizationId: ORGANIZATION,
          role: OrganizationUserRole.ADMIN,
          disabledAt: null,
        },
      }),
    ).resolves.toBe(1);
  });
});
