/**
 * The local identity rows over a database held in memory: ids are minted, rows are found again.
 * @see specs/self-hosting/connected-services/testing-licenses.feature
 */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  resolveOrganizationId,
  upsertOrganization,
  upsertProject,
  upsertSeedUser,
  upsertTeam,
} from "../seed-local-rows.ts";

const RETIRED_ADMIN_ID = "local-dev-admin-user";
const ADMIN_EMAIL = "admin@mail.langwatch.localhost";

const rowSchema = z.record(z.string(), z.unknown());
const slugWhereSchema = z.object({ where: z.object({ slug: z.string() }) });
const upsertSchema = z.object({
  where: z.object({ slug: z.string() }),
  create: rowSchema,
  update: rowSchema,
});
const userWriteSchema = z.object({
  where: z.object({ id: z.string() }).optional(),
  data: rowSchema,
});
const userFindSchema = z.object({ where: rowSchema });

type Row = Record<string, unknown>;
type SlugTable = "organization" | "team" | "project";

/** Organization, team, project and user tables, each upsert looked up by slug or email. */
class LocalDatabase {
  readonly tables: Record<SlugTable | "user", Row[]> = {
    organization: [],
    team: [],
    project: [],
    user: [],
  };

  readonly prisma = prismaDouble({
    organization: {
      findUnique: async (args: unknown) => {
        const { where } = slugWhereSchema.parse(args);
        const held = this.tables.organization.find((row) => row.slug === where.slug);
        return held ? { id: held.id } : null;
      },
      upsert: async (args: unknown) => this.upsert("organization", args),
    },
    team: { upsert: async (args: unknown) => this.upsert("team", args) },
    project: { upsert: async (args: unknown) => this.upsert("project", args) },
    user: {
      findFirst: async (args: unknown) => {
        const { where } = userFindSchema.parse(args);
        return (
          this.tables.user.find((row) =>
            Object.entries(where).every(([field, value]) => row[field] === value),
          ) ?? null
        );
      },
      update: async (args: unknown) => {
        const { where, data } = userWriteSchema.parse(args);
        const held = this.tables.user.find((row) => row.id === where?.id);
        if (!held) throw new Error("no such user");
        Object.assign(held, data);
        return held;
      },
      create: async (args: unknown) => {
        const { data } = userWriteSchema.parse(args);
        this.tables.user.push(data);
        return data;
      },
    },
  });

  private upsert(table: SlugTable, args: unknown): Row {
    const { where, create, update } = upsertSchema.parse(args);
    const held = this.tables[table].find((row) => row.slug === where.slug);
    if (held) return Object.assign(held, update);
    this.tables[table].push({ ...create });
    return create;
  }
}

/** Runs every local row the storage seed writes, in the seed's order. */
async function seedLocalRows(database: LocalDatabase) {
  const { prisma } = database;
  const organizationId = await resolveOrganizationId({ prisma, slug: "local-dev-org" });
  const organization = await upsertOrganization({
    prisma,
    id: organizationId,
    slug: "local-dev-org",
    name: "Local Dev Organization",
    license: null,
  });
  const team = await upsertTeam({
    prisma,
    slug: "local-dev-team",
    name: "Local Dev Team",
    organizationId: organization.id,
  });
  const project = await upsertProject({
    prisma,
    slug: "local-dev-project",
    name: "Local Dev Project",
    apiKey: "sk-lw-local-development-key",
    teamId: team.id,
    isPastOnboarding: false,
    hasFirstMessageOverride: false,
  });
  const admin = await upsertSeedUser({
    prisma,
    email: ADMIN_EMAIL,
    name: "Haven Local Admin",
    retiredId: RETIRED_ADMIN_ID,
  });
  return { organization, team, project, admin };
}

const FIXED_IDS = [
  "local-dev-organization",
  "local-dev-team",
  "local-dev-project",
  RETIRED_ADMIN_ID,
];

describe("given a database the storage seed has not run on", () => {
  let database: LocalDatabase;

  beforeEach(() => {
    database = new LocalDatabase();
  });

  describe("when the storage seed creates the local rows", () => {
    /** @scenario "Seeded local rows get random ids" */
    it("gives each row a freshly generated id rather than a fixed one", async () => {
      const { organization, team, project, admin } = await seedLocalRows(database);

      const ids = [organization.id, team.id, project.id, admin.id];
      expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
      expect(ids.filter((id) => FIXED_IDS.includes(String(id)))).toEqual([]);
      expect(new Set(ids).size).toBe(ids.length);
    });

    /** @scenario "Seeded local rows get random ids" */
    it("shares no id with a second database seeded separately", async () => {
      const first = await seedLocalRows(database);
      const second = await seedLocalRows(new LocalDatabase());

      const firstIds = [first.organization.id, first.team.id, first.project.id, first.admin.id];
      const secondIds = [
        second.organization.id,
        second.team.id,
        second.project.id,
        second.admin.id,
      ];
      expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
    });

    /** @scenario "Seeded local rows get random ids" */
    it("keeps every slug and the admin address unchanged", async () => {
      const { organization, team, project, admin } = await seedLocalRows(database);

      expect(organization.slug).toBe("local-dev-org");
      expect(team.slug).toBe("local-dev-team");
      expect(project.slug).toBe("local-dev-project");
      expect(admin.email).toBe(ADMIN_EMAIL);
    });
  });

  describe("when the storage seed runs a second time", () => {
    /** @scenario "Seeding again finds the rows it already made" */
    it("updates the same rows by slug and email and creates no second copy", async () => {
      const first = await seedLocalRows(database);
      const rowsAfterFirst = structuredClone(database.tables);

      const second = await seedLocalRows(database);

      expect(database.tables).toEqual(rowsAfterFirst);
      expect(second.organization.id).toBe(first.organization.id);
      expect(second.team.id).toBe(first.team.id);
      expect(second.project.id).toBe(first.project.id);
      expect(second.admin.id).toBe(first.admin.id);
      expect(database.tables.user).toHaveLength(1);
    });

    /** @scenario "Reseeding keeps the seeded addresses stable" */
    it("keeps the admin address the same, so no duplicate user appears", async () => {
      await seedLocalRows(database);
      await seedLocalRows(database);

      expect(database.tables.user.map((row) => row.email)).toEqual([ADMIN_EMAIL]);
    });
  });
});

describe("given an admin an older seed wrote under its fixed id and a retired address", () => {
  describe("when the storage seed runs", () => {
    /** @scenario "A database seeded before the address rename reseeds onto the new one" */
    it("rewrites that account's address in place and adds no second admin", async () => {
      const database = new LocalDatabase();
      database.tables.user.push({ id: RETIRED_ADMIN_ID, email: "admin@haven.localhost" });

      const { admin } = await seedLocalRows(database);

      expect(admin.id).toBe(RETIRED_ADMIN_ID);
      expect(database.tables.user).toEqual([{ id: RETIRED_ADMIN_ID, email: ADMIN_EMAIL }]);
    });

    /** @scenario "A database seeded before the address rename reseeds onto the new one" */
    it("keeps the account already holding the new address when both exist", async () => {
      const database = new LocalDatabase();
      database.tables.user.push(
        { id: RETIRED_ADMIN_ID, email: "admin@haven.localhost" },
        { id: "current-admin", email: ADMIN_EMAIL },
      );

      const { admin } = await seedLocalRows(database);

      expect(admin.id).toBe("current-admin");
      expect(database.tables.user.map((row) => row.email)).toEqual([
        "admin@haven.localhost",
        ADMIN_EMAIL,
      ]);
    });
  });
});
