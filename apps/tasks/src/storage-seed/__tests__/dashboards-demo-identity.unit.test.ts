/**
 * The dashboards demo's identity rows, over a database held in memory: what a run leaves, that a
 * second run leaves the same, and who is made a member.
 * @see specs/setup/dashboards-demo-seed.feature
 */
import type { AuthzApi, AuthzAttachBindingsInput } from "@langwatch/authz-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { findDemoMember, seedDashboardsDemoIdentity } from "../dashboards-demo-identity.ts";
import {
  DASHBOARDS_DEMO_ORGANIZATION,
  DASHBOARDS_DEMO_PROJECTS,
  DASHBOARDS_DEMO_TEAM,
} from "../dashboards-demo-ids.ts";

const MEMBER = "user-who-sees-the-demo";
const ADMIN = { id: "local-dev-admin-user", email: "admin@mail.langwatch.localhost" };
const SOMEONE = { id: "user-with-an-email", email: "someone@example.dev" };

const rowSchema = z.record(z.string(), z.unknown());
const upsertSchema = z.object({ where: rowSchema, create: rowSchema, update: rowSchema });
const archiveSchema = z.object({
  where: z.object({ teamId: z.string(), id: z.object({ notIn: z.array(z.string()) }) }),
  data: z.object({ archivedAt: z.date() }),
});

type Row = Record<string, unknown>;

/** What the database itself fills in on a create that names no value. */
const COLUMN_DEFAULTS: Readonly<Record<string, Row>> = { project: { archivedAt: null } };

/** The tables the identity seed writes, each row under the key its upsert looks it up by. */
class DemoDatabase {
  readonly tables = {
    organization: new Map<string, Row>(),
    team: new Map<string, Row>(),
    project: new Map<string, Row>(),
    organizationUser: new Map<string, Row>(),
    teamUser: new Map<string, Row>(),
  };
  readonly users = [ADMIN, SOMEONE];
  /** Every grant list the authz API was asked to attach. */
  readonly attached: AuthzAttachBindingsInput[] = [];

  readonly authz = createApiFixture<AuthzApi>({
    attachBindings: async (input) => {
      this.attached.push(input);
      return { attached: input.bindings.map(({ bindingId }) => bindingId), duplicates: [] };
    },
  });

  // No user write is scripted, so a run that created or changed a user would throw by name.
  readonly prisma = prismaDouble({
    user: {
      findFirst: async (args: unknown) => {
        const { where } = z.object({ where: rowSchema }).parse(args);
        const wanted = Object.entries(where);
        return (
          this.users.find((user) =>
            wanted.every(([field, value]) => rowSchema.parse(user)[field] === value),
          ) ?? null
        );
      },
    },
    organization: { upsert: async (args: unknown) => this.upsert("organization", args) },
    team: { upsert: async (args: unknown) => this.upsert("team", args) },
    project: {
      upsert: async (args: unknown) => this.upsert("project", args),
      updateMany: async (args: unknown) => {
        const { where, data } = archiveSchema.parse(args);
        const stale = [...this.tables.project.values()].filter(
          (row) =>
            row.teamId === where.teamId &&
            !row.archivedAt &&
            !where.id.notIn.includes(String(row.id)),
        );
        for (const row of stale) row.archivedAt = data.archivedAt;
        return { count: stale.length };
      },
    },
    organizationUser: { upsert: async (args: unknown) => this.upsert("organizationUser", args) },
    teamUser: { upsert: async (args: unknown) => this.upsert("teamUser", args) },
  });

  private upsert(table: keyof DemoDatabase["tables"], args: unknown): Row {
    const { where, create, update } = upsertSchema.parse(args);
    const key = JSON.stringify(where);
    const held = this.tables[table].get(key);
    const row = held ? { ...held, ...update } : { ...COLUMN_DEFAULTS[table], ...create };
    this.tables[table].set(key, row);
    return row;
  }

  rows(table: keyof DemoDatabase["tables"]): Row[] {
    return [...this.tables[table].values()];
  }
}

const seed = (database: DemoDatabase) =>
  seedDashboardsDemoIdentity({ prisma: database.prisma, authz: database.authz, userId: MEMBER });

describe("given a database with users and no demo", () => {
  let database: DemoDatabase;

  beforeEach(() => {
    database = new DemoDatabase();
  });

  describe("when the identity is seeded", () => {
    /** @scenario "Three projects run named agents, and one project is empty" */
    it("makes the organization with its four projects, each under its fixed key", async () => {
      await seed(database);

      expect(database.rows("organization")).toEqual([{ ...DASHBOARDS_DEMO_ORGANIZATION }]);
      expect(database.rows("team")).toEqual([
        { ...DASHBOARDS_DEMO_TEAM, organizationId: DASHBOARDS_DEMO_ORGANIZATION.id },
      ]);
      expect(
        database.rows("project").map(({ name, apiKey, teamId, integrated }) => ({
          name,
          apiKey,
          teamId,
          integrated,
        })),
      ).toEqual(
        [
          { name: "Customer care", apiKey: "sk-lw-dashboards-demo-care", integrated: true },
          { name: "Agent platform", apiKey: "sk-lw-dashboards-demo-platform", integrated: true },
          { name: "Engineering", apiKey: "sk-lw-dashboards-demo-engineering", integrated: true },
          {
            name: "New project (no data yet)",
            apiKey: "sk-lw-dashboards-demo-day-zero",
            integrated: false,
          },
        ].map((project) => ({ ...project, teamId: DASHBOARDS_DEMO_TEAM.id })),
      );
    });

    /** @scenario "Three projects run named agents, and one project is empty" */
    it("names the agents each project runs", () => {
      const agents = Object.fromEntries(
        DASHBOARDS_DEMO_PROJECTS.map(({ name, agents: run }) => [name, run.map((a) => a.name)]),
      );

      expect(agents).toEqual({
        "Customer care": ["shop-assistant", "help-center-answerer", "delivery-caller"],
        "Agent platform": ["checkout-planner", "invoice-classifier", "catalogue-copywriter"],
        Engineering: ["code-helper", "ops-cowork"],
        "New project (no data yet)": [],
      });
    });

    /** @scenario "Three projects run named agents, and one project is empty" */
    it("makes the member an admin of the organization and its team, and creates no user", async () => {
      await seed(database);

      expect(database.rows("organizationUser")).toEqual([
        { userId: MEMBER, organizationId: DASHBOARDS_DEMO_ORGANIZATION.id, role: "ADMIN" },
      ]);
      expect(database.rows("teamUser")).toEqual([
        { userId: MEMBER, teamId: DASHBOARDS_DEMO_TEAM.id, role: "ADMIN" },
      ]);
      expect(database.attached).toHaveLength(1);
      expect(database.attached[0]).toMatchObject({
        organizationId: DASHBOARDS_DEMO_ORGANIZATION.id,
        onDuplicate: "skip",
      });
      expect(
        database.attached[0]?.bindings.map(({ principal, role, scopeType, scopeId }) => ({
          principal,
          role,
          scopeType,
          scopeId,
        })),
      ).toEqual([
        {
          principal: { userId: MEMBER },
          role: "ADMIN",
          scopeType: "ORGANIZATION",
          scopeId: DASHBOARDS_DEMO_ORGANIZATION.id,
        },
        {
          principal: { userId: MEMBER },
          role: "ADMIN",
          scopeType: "TEAM",
          scopeId: DASHBOARDS_DEMO_TEAM.id,
        },
      ]);
    });
  });

  describe("when the demo team holds a project the seed no longer lists", () => {
    /** @scenario "Three projects run named agents, and one project is empty" */
    it("archives that project and leaves the listed ones live", async () => {
      await seed(database);
      database.tables.project.set("an-older-demo-project", {
        id: "dashboards-demo-retired",
        teamId: DASHBOARDS_DEMO_TEAM.id,
        archivedAt: null,
      });

      await seed(database);

      const archived = database
        .rows("project")
        .filter(({ archivedAt }) => archivedAt instanceof Date);
      expect(archived.map(({ id }) => id)).toEqual(["dashboards-demo-retired"]);
    });
  });

  describe("when the identity is seeded a second time", () => {
    /** @scenario "Re-running the seed sends only what a project does not hold yet" */
    it("leaves the same organization, team, projects and keys, none of them twice", async () => {
      await seed(database);
      const first = structuredClone(database.tables);

      await seed(database);

      expect(database.tables).toEqual(first);
      expect(database.rows("project")).toHaveLength(DASHBOARDS_DEMO_PROJECTS.length);
    });
  });

  describe("when the run names a user's email", () => {
    /** @scenario "The demo user is chosen by email, or is the local-dev admin" */
    it("takes that user as the member", async () => {
      const member = await findDemoMember({ prisma: database.prisma, email: SOMEONE.email });

      expect(member).toEqual(SOMEONE);
    });
  });

  describe("when the run names no email", () => {
    /** @scenario "The demo user is chosen by email, or is the local-dev admin" */
    it("takes the local-dev admin", async () => {
      const member = await findDemoMember({ prisma: database.prisma, email: undefined });

      expect(member).toEqual(ADMIN);
    });
  });

  describe("when the run names an email no user has", () => {
    /** @scenario "A missing demo user refuses by name" */
    it("refuses, naming the email and the flag that sets it", async () => {
      const finding = findDemoMember({ prisma: database.prisma, email: "nobody@example.dev" });

      await expect(finding).rejects.toThrow(
        "No user has the email nobody@example.dev; sign up once, or set DASHBOARDS_DEMO_USER_EMAIL",
      );
    });
  });
});
