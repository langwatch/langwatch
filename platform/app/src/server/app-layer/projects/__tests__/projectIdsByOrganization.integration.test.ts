/**
 * @vitest-environment node
 * @integration
 *
 * Every project id of an organization, against the real Postgres rows: the
 * scope of the governance cost screen's metered lane, which reads the gateway
 * ledger keyed by the traffic's own project tenant.
 *
 * INCLUDING archived projects and every kind. A project archived last month
 * still has gateway spend inside a thirty-day window, and leaving it out would
 * make the metered lane fall the day someone tidied the project list.
 *
 * @see specs/governance/governance-cost-screen.feature
 *   ("The metered lane counts gateway spend from every project of the organization")
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { PrismaProjectRepository } from "../repositories/project.prisma.repository";

const tag = nanoid(8);

let organizationId: string;
let otherOrganizationId: string;
const seeded: string[] = [];

const repository = new PrismaProjectRepository(prisma);

async function seedOrganization(label: string): Promise<{
  organizationId: string;
  teamId: string;
}> {
  const organization = await prisma.organization.create({
    data: { name: `ids-${label}-${tag}`, slug: `ids-${label}-${tag}` },
  });
  const team = await prisma.team.create({
    data: {
      name: `ids-${label}-${tag}`,
      slug: `ids-${label}-${tag}`,
      organizationId: organization.id,
    },
  });
  return { organizationId: organization.id, teamId: team.id };
}

/**
 * Ids are given, not generated, and differ only in a final digit after a
 * shared prefix. Postgres orders ids by the database's collation, where a
 * punctuation-led nanoid ("_Cwh...") can sort before a digit-led one; the
 * test's own sort compares code units and puts it last. With a single digit
 * as the only difference, every collation and the code-unit sort agree.
 */
async function seedProject({
  teamId,
  label,
  position,
  archivedAt = null,
  kind,
}: {
  teamId: string;
  label: string;
  position: number;
  archivedAt?: Date | null;
  kind?: string;
}): Promise<string> {
  const project = await prisma.project.create({
    data: {
      id: `ids-${tag}-${position}`,
      name: `ids-${label}-${tag}`,
      slug: `ids-${label}-${tag}`,
      apiKey: `ids-${label}-${tag}`,
      teamId,
      language: "typescript",
      framework: "other",
      archivedAt,
      ...(kind ? { kind } : {}),
    },
  });
  seeded.push(project.id);
  return project.id;
}

beforeAll(async () => {
  const mine = await seedOrganization("mine");
  organizationId = mine.organizationId;
  // Seeded OUT of id order, so a read that merely returned rows as they
  // were inserted could not pass the ordering assertion.
  await seedProject({ teamId: mine.teamId, label: "live", position: 2 });
  await seedProject({
    teamId: mine.teamId,
    label: "archived",
    position: 1,
    archivedAt: new Date("2026-08-01T00:00:00.000Z"),
  });
  await seedProject({
    teamId: mine.teamId,
    label: "governance",
    position: 3,
    kind: "internal_governance",
  });

  const other = await seedOrganization("other");
  otherOrganizationId = other.organizationId;
  await seedProject({ teamId: other.teamId, label: "elsewhere", position: 4 });
});

afterAll(async () => {
  for (const orgId of [organizationId, otherOrganizationId]) {
    if (!orgId) continue;
    await cleanupTestRows(prisma, [
      ["project", { team: { organizationId: orgId } }],
      ["team", { organizationId: orgId }],
      ["organization", { id: orgId }],
    ]);
  }
});

describe("ProjectRepository.findAllIdsByOrganization", () => {
  describe("given live, archived and governance projects across two organizations", () => {
    it("returns every project of the organization, archived and every kind, ordered by id, and none of another's", async () => {
      const ids = await repository.findAllIdsByOrganization({ organizationId });

      // The organization's three, whatever their state or kind, ordered by
      // id ascending — this repository's own `orderBy`, not a property of
      // the caller — so the metered lane's ledger read, which resolves its
      // ClickHouse client by the FIRST id, routes one organization's reads
      // to the same client every time. Insertion order was 2, 1, 3.
      const mine = seeded.slice(0, 3);
      expect(ids).toEqual([...mine].sort());
      expect(ids).not.toEqual(mine);
      // This is the tenancy boundary. The metered lane's ledger read takes
      // these ids as its whole scope, so an id leaking across organizations
      // here is a cross-organization money read there.
      expect(ids).not.toContain(seeded[3]);
    });
  });

  describe("given an organization with no projects", () => {
    it("answers an empty list, never an unfiltered one", async () => {
      const empty = await prisma.organization.create({
        data: { name: `ids-empty-${tag}`, slug: `ids-empty-${tag}` },
      });
      try {
        expect(
          await repository.findAllIdsByOrganization({
            organizationId: empty.id,
          }),
        ).toEqual([]);
      } finally {
        await prisma.organization.delete({ where: { id: empty.id } });
      }
    });
  });
});
