/**
 * @vitest-environment node
 * ADR-177 block D over real rows: who may open an aggregate, which projects its explicit rule may
 * name, and that the rule column's documented down path runs. Main's aggregate-project-create.
 * @see specs/governance/aggregate-project.feature
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { AGGREGATE_DEFAULT_RULE } from "@langwatch/project-contract";
import { cleanupTestRows, documentedDownPath } from "@langwatch/test-harness/prisma";
import { nowInstant } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaProjectRepository } from "../../repositories/prisma/prisma.project.repository.ts";
import { AggregateProjectService } from "../aggregate-project.service.ts";

const DB_URL = process.env.DATABASE_URL ?? process.env.LANGWATCH_TEST_DATABASE_URL;
const AGGREGATE_RULE_MIGRATION = "20261006120002_project_aggregate_rule";

describe.skipIf(!DB_URL)(
  "given an organisation with a shared, a personal and a governance project",
  () => {
    const prisma = new PrismaClient({
      adapter: PrismaDriverAdapterService.create().create(DB_URL ?? "").adapter,
    });
    const repository = PrismaProjectRepository.create({ prisma });
    const ns = `agg-create-${randomUUID().slice(0, 8)}`;
    const by = { id: `user-${ns}` };
    const ids = {
      organization: "",
      foreignOrganization: "",
      team: "",
      shared: "",
      personal: "",
      governance: "",
      foreign: "",
      aggregate: "",
    };

    const serviceFor = ({ role }: { role: "ADMIN" | "MEMBER" | null }) =>
      AggregateProjectService.create({
        repository,
        organizations: {
          isMember: async () => role !== null,
          getMember: async ({
            organizationId,
            userId,
          }: {
            organizationId: string;
            userId: string;
          }) => {
            if (role === null) throw new Error("not a member");
            return {
              userId,
              organizationId,
              role,
              disabledAt: null,
              createdAt: nowInstant(),
              updatedAt: nowInstant(),
              user: { id: userId, name: null, email: null },
              teams: [],
            };
          },
        },
        lifecycle: { aggregateRuleChanged: async () => undefined },
      });

    async function seedProject({
      teamId,
      suffix,
      extra = {},
    }: {
      teamId: string;
      suffix: string;
      extra?: { isPersonal?: boolean; ownerUserId?: string; kind?: string; aggregateRule?: object };
    }): Promise<string> {
      const project = await prisma.project.create({
        data: {
          name: `Project ${suffix}`,
          slug: `--test-project-${ns}-${suffix}`,
          apiKey: `sk-lw-test-${ns}-${suffix}`,
          teamId,
          language: "en",
          framework: "test",
          ...extra,
        },
      });
      return project.id;
    }

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: { name: `Org ${ns}`, slug: `--test-org-${ns}` },
      });
      ids.organization = organization.id;
      const team = await prisma.team.create({
        data: { name: "Team", slug: `--test-team-${ns}`, organizationId: organization.id },
      });
      ids.team = team.id;
      await prisma.user.create({ data: { id: by.id, name: "Seller", email: `${ns}@example.com` } });
      ids.shared = await seedProject({ teamId: team.id, suffix: "shared" });
      ids.personal = await seedProject({
        teamId: team.id,
        suffix: "personal",
        extra: { isPersonal: true, ownerUserId: by.id },
      });
      ids.governance = await seedProject({
        teamId: team.id,
        suffix: "governance",
        extra: { kind: "internal_governance" },
      });
      ids.aggregate = await seedProject({
        teamId: team.id,
        suffix: "aggregate",
        extra: { kind: "aggregate", aggregateRule: AGGREGATE_DEFAULT_RULE },
      });

      const foreign = await prisma.organization.create({
        data: { name: `Foreign ${ns}`, slug: `--test-org-${ns}-foreign` },
      });
      ids.foreignOrganization = foreign.id;
      const foreignTeam = await prisma.team.create({
        data: { name: "Foreign", slug: `--test-team-${ns}-foreign`, organizationId: foreign.id },
      });
      ids.foreign = await seedProject({ teamId: foreignTeam.id, suffix: "foreign" });
    });

    afterAll(async () => {
      const organizations = [ids.organization, ids.foreignOrganization].filter(Boolean);
      if (organizations.length > 0) {
        await cleanupTestRows(prisma, [
          ["project", { team: { organizationId: { in: organizations } } }],
          ["team", { organizationId: { in: organizations } }],
          ["user", { id: by.id }],
          ["organization", { id: { in: organizations } }],
        ]);
      }
      await prisma.$disconnect();
    });

    describe("when an admin opens an aggregate without a rule", () => {
      /** @scenario "An admin creates an aggregate project from the new-project flow" */
      it("writes the all-personal rule, which reads the organisation's personal projects", async () => {
        await expect(
          serviceFor({ role: "ADMIN" }).createFields({
            organizationId: ids.organization,
            kind: "aggregate",
            by,
          }),
        ).resolves.toEqual({ kind: "aggregate", aggregateRule: AGGREGATE_DEFAULT_RULE });
        await expect(
          repository.findPersonalProjectIds({ organizationId: ids.organization }),
        ).resolves.toEqual([ids.personal]);
      });
    });

    describe("when a member who is not an admin asks to open one", () => {
      /** @scenario "A member who is not an admin is refused when creating an aggregate project" */
      it("is refused as admin only", async () => {
        await expect(
          serviceFor({ role: "MEMBER" }).createFields({
            organizationId: ids.organization,
            kind: "aggregate",
            by,
          }),
        ).rejects.toMatchObject({ code: "aggregate_project_admin_only" });
      });
    });

    describe("when the admin names an explicit list", () => {
      /** @scenario "The rule may name an explicit list of any projects" */
      it("accepts and reads exactly those two, one of which is not personal", async () => {
        const aggregateRule = { kind: "explicit" as const, projectIds: [ids.shared, ids.personal] };
        await expect(
          serviceFor({ role: "ADMIN" }).createFields({
            organizationId: ids.organization,
            kind: "aggregate",
            aggregateRule,
            by,
          }),
        ).resolves.toEqual({ kind: "aggregate", aggregateRule });
        await expect(
          repository.findReadableProjectIds({
            organizationId: ids.organization,
            projectIds: aggregateRule.projectIds,
          }),
        ).resolves.toEqual([ids.shared, ids.personal].toSorted());
      });

      it.each([
        ["a project in another organisation", () => ids.foreign],
        ["the hidden governance project", () => ids.governance],
        ["another aggregate", () => ids.aggregate],
      ])("refuses a list naming %s", async (_name, outsider) => {
        await expect(
          serviceFor({ role: "ADMIN" }).createFields({
            organizationId: ids.organization,
            kind: "aggregate",
            aggregateRule: { kind: "explicit", projectIds: [ids.shared, outsider()] },
            by,
          }),
        ).rejects.toMatchObject({ code: "aggregate_rule_outside_organization" });
      });
    });

    describe("when the aggregate rule migration is rolled back by hand", () => {
      /** ADR-177 gate: the documented down path runs, through psql in a rolled-back transaction. */
      it("drops the column by the documented down path and keeps every row", async () => {
        const columnCount =
          "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Project' AND column_name = 'aggregateRule';";
        const statements = [
          "BEGIN;",
          columnCount,
          documentedDownPath({ migration: AGGREGATE_RULE_MIGRATION }),
          columnCount,
          "ROLLBACK;",
        ];
        const output = execFileSync(
          "psql",
          [
            DB_URL ?? "",
            "-v",
            "ON_ERROR_STOP=1",
            "-qtA",
            ...statements.flatMap((sql) => ["-c", sql]),
          ],
          { encoding: "utf8" },
        );
        // Present before, gone after: a filter that matched nothing would read 0 both times.
        expect(output.trim().split("\n")).toEqual(["1", "0"]);
        await expect(
          prisma.project.findUniqueOrThrow({
            where: { id: ids.aggregate },
            select: { aggregateRule: true },
          }),
        ).resolves.toEqual({ aggregateRule: AGGREGATE_DEFAULT_RULE });
      });
    });
  },
);
