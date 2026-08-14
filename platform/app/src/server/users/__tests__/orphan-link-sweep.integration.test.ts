/**
 * @vitest-environment node
 *
 * The sweep's candidate query is raw SQL, so its unit tests — which run
 * against an in-memory stand-in computing the anti-join's meaning — cannot see
 * a typo in the SQL text. And a broken query fails silently in exactly the
 * shape a healthy fleet has: the sweep finds nothing. That is the same defect
 * that once let a reaper be written, tested and never called.
 *
 * This suite executes the real query against a real Postgres schema, so a
 * renamed column, a case-folded identifier or a wrong join key fails here
 * rather than in production.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OrganizationUserRole } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";

import { runOrphanLinkSweep } from "../orphan-link-sweep";

const ns = nanoid(8);
const SWEPT_AT = new Date("2026-06-01T00:00:00Z");

let organizationId: string;
let connectionId: string;
let offboardedUserId: string;
let activeUserId: string;

const linksFor = (userIdColumn: string | null, externalId: string) =>
  prisma.providerIdentityLink.findMany({
    where: { organizationId, externalId, userId: userIdColumn },
    orderBy: { seq: "asc" },
  });

beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { name: "Orphan Sweep Org", slug: `--test-org-sweep-${ns}` },
  });
  organizationId = organization.id;

  const [offboarded, active] = await Promise.all([
    prisma.user.create({
      data: { name: "Offboarded", email: `sweep-gone-${ns}@example.com` },
    }),
    prisma.user.create({
      data: { name: "Active", email: `sweep-here-${ns}@example.com` },
    }),
  ]);
  offboardedUserId = offboarded.id;
  activeUserId = active.id;

  await prisma.organizationUser.createMany({
    data: [
      // The shape a directory offboarding leaves behind: the row survives,
      // disabled, so seat history and past attribution stay readable.
      {
        userId: offboardedUserId,
        organizationId,
        role: OrganizationUserRole.MEMBER,
        disabledAt: new Date("2026-01-15T00:00:00Z"),
      },
      {
        userId: activeUserId,
        organizationId,
        role: OrganizationUserRole.MEMBER,
      },
    ],
  });

  const connection = await prisma.ingestionSource.create({
    data: {
      organizationId,
      sourceType: "claude_compliance",
      name: `Sweep Connection ${ns}`,
      ingestSecretHash: "unused-by-this-suite",
    },
  });
  connectionId = connection.id;

  await prisma.providerIdentityLink.createMany({
    data: [
      {
        organizationId,
        provider: "anthropic",
        providerConnectionId: connectionId,
        externalKind: "member_id",
        externalId: `orphan-${ns}`,
        userId: offboardedUserId,
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        source: "manual",
        actorUserId: null,
      },
      {
        organizationId,
        provider: "anthropic",
        providerConnectionId: connectionId,
        externalKind: "member_id",
        externalId: `still-here-${ns}`,
        userId: activeUserId,
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        source: "manual",
        actorUserId: null,
      },
    ],
  });
});

afterAll(() =>
  cleanupTestRows(prisma, [
    ["providerIdentityLink", { organizationId }],
    ["ingestionSource", { organizationId }],
    ["organizationUser", { organizationId }],
    ["organization", { id: organizationId }],
    ["user", { id: { in: [offboardedUserId, activeUserId] } } as never],
  ]),
);

describe("runOrphanLinkSweep against a real database", () => {
  describe("given one person left open in an organization they no longer belong to", () => {
    it("finds exactly them — the raw anti-join runs, and it discriminates", async () => {
      const result = await runOrphanLinkSweep({
        prisma,
        now: () => SWEPT_AT,
      });

      // Other suites share this database, so assert on this fixture's rows
      // rather than on the fleet-wide totals.
      expect(result.candidates).toBeGreaterThanOrEqual(1);

      const closing = await linksFor(null, `orphan-${ns}`);
      expect(closing).toHaveLength(1);
      expect(closing[0]).toMatchObject({
        source: "offboarding",
        actorUserId: null,
        effectiveFrom: SWEPT_AT,
      });
    });

    it("leaves the still-active member's link open", async () => {
      expect(await linksFor(null, `still-here-${ns}`)).toHaveLength(0);
    });

    it("appends nothing on a second pass", async () => {
      await runOrphanLinkSweep({ prisma, now: () => SWEPT_AT });

      expect(await linksFor(null, `orphan-${ns}`)).toHaveLength(1);
    });
  });
});
