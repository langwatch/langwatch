/**
 * Saved workbench charts against a real Postgres.
 *
 * The two claims that can only be made here: that the `kind` discriminator
 * actually keeps the chart builder's rows and the workbench's rows out of each
 * other's reads, and that every predicate really does carry the project — a
 * repository whose tenancy is asserted against an in-memory fake is asserting
 * the fake's `filter`, not the SQL that ships.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { nanoid } from "nanoid";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { VEGA_LITE_SCHEMA_URL } from "~/features/analytics-query/visualization/vegaLiteSchema";
import type { Organization, Project, Team } from "~/generated/prisma/client";
import { AppAutomationRuntime } from "~/runtime/app/features/automation";
import { prisma } from "~/server/db";

import type { Protections } from "../../../traces/protections";
import { BUILDER_CHART_KIND, WORKBENCH_SQL_CHART_KIND } from "../../chartKinds";
import { LangWatchQLService } from "../../lwql/lwql.service";
import { SavedWorkbenchChartRepository } from "../savedWorkbenchChart.repository";
import {
  type SavedWorkbenchChart,
  SavedWorkbenchChartService,
} from "../savedWorkbenchChart.service";
import { WORKBENCH_CHART_DEFINITION_VERSION } from "../workbenchChartDefinition";

const FULLY_PERMITTED: Protections = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
};

const SQL =
  "SELECT count() AS value FROM analytics.traces " +
  "WHERE OccurredAt >= {since:DateTime}";

const SPEC = {
  $schema: VEGA_LITE_SCHEMA_URL,
  data: { name: "query_result" },
  mark: "bar",
  encoding: { y: { field: "value", type: "quantitative" } },
};

const DEFINITION = {
  version: WORKBENCH_CHART_DEFINITION_VERSION,
  sql: SQL,
  parameters: { since: "2026-02-01 00:00:00" },
  vegaLiteSpec: SPEC,
};

describe("saved workbench charts (integration)", () => {
  let service: SavedWorkbenchChartService;
  let organization: Organization;
  let team: Team;
  let project: Project;
  let otherProject: Project;

  const createProject = async () =>
    await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: nanoid() }),
        teamId: team.id,
        personalFeatures: {},
      },
    });

  const save = async (
    overrides: { name?: string; definition?: unknown } = {},
  ): Promise<SavedWorkbenchChart> =>
    await service.createChart({
      projectId: project.id,
      protections: FULLY_PERMITTED,
      input: {
        name: overrides.name ?? "Traces per day",
        definition: overrides.definition ?? DEFINITION,
      },
    });

  // The tenant rows are scaffolding, not subject matter: no test here mutates
  // the organization, the team or either project, so they are built once and
  // only the charts are cleared between tests.
  beforeAll(async () => {
    service = new SavedWorkbenchChartService({
      repository: new SavedWorkbenchChartRepository(prisma),
      lwql: new LangWatchQLService({
        executor: null,
        database: "analytics",
      }),
    });

    organization = await prisma.organization.create({
      data: { name: "Test Org", slug: `test-org-${nanoid()}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${nanoid()}`,
        organizationId: organization.id,
      },
    });
    project = await createProject();
    otherProject = await createProject();
  });

  afterEach(async () => {
    await prisma.customGraph.deleteMany({
      where: { projectId: { in: [project.id, otherProject.id] } },
    });
  });

  afterAll(async () => {
    for (const { id } of [project, otherProject]) {
      await prisma.project.delete({ where: { id } });
    }
    await prisma.team.delete({ where: { id: team.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  });

  describe("given a chart the member has saved", () => {
    describe("when they read it back", () => {
      /** @scenario "A saved chart reads back with its SQL, parameters and specification intact" */
      it("returns the statement, the parameter values and the specification unchanged", async () => {
        const saved = await save();

        const read = await service.getById({
          id: saved.id,
          projectId: project.id,
        });

        expect(read.definition.sql).toBe(SQL);
        expect(read.definition.parameters).toEqual({
          since: "2026-02-01 00:00:00",
        });
        expect(read.definition.vegaLiteSpec).toEqual(SPEC);
        expect(read.name).toBe("Traces per day");
      });
    });
  });

  describe("given a chart already saved under a caller-supplied id", () => {
    describe("when the member saves another chart with the same id", () => {
      it("refuses the collision as its own handled error, not an unknown failure", async () => {
        const id = `chart-${nanoid()}`;
        await service.createChart({
          projectId: project.id,
          protections: FULLY_PERMITTED,
          input: { id, name: "First", definition: DEFINITION },
        });

        await expect(
          service.createChart({
            projectId: project.id,
            protections: FULLY_PERMITTED,
            input: { id, name: "Second", definition: DEFINITION },
          }),
        ).rejects.toMatchObject({
          code: "saved_workbench_chart_already_exists",
        });

        // The first save is untouched.
        const kept = await service.getById({ id, projectId: project.id });
        expect(kept.name).toBe("First");
      });
    });
  });

  describe("given the project holds saved charts and a builder chart", () => {
    describe("when the member lists the saved workbench charts", () => {
      /** @scenario "A saved chart is listed among the project's workbench charts" */
      it("lists every saved chart and no builder chart", async () => {
        const first = await save({ name: "First" });
        const second = await save({ name: "Second" });
        const builder = await prisma.customGraph.create({
          data: {
            projectId: project.id,
            name: "A builder chart",
            graph: { series: [{ metric: "metadata.trace_id" }] },
          },
        });

        const listed = await service.getAll({ projectId: project.id });

        expect(listed.map(({ id }) => id).sort()).toEqual(
          [first.id, second.id].sort(),
        );
        expect(listed.map(({ id }) => id)).not.toContain(builder.id);
      });
    });

    describe("when the member reads the builder chart as a workbench chart", () => {
      /** @scenario "A builder chart is not readable as a workbench chart" */
      it("does not find it, and leaves it untouched", async () => {
        const builder = await prisma.customGraph.create({
          data: {
            projectId: project.id,
            name: "A builder chart",
            graph: { series: [{ metric: "metadata.trace_id" }] },
          },
        });

        await expect(
          service.getById({ id: builder.id, projectId: project.id }),
        ).rejects.toMatchObject({ code: "saved_workbench_chart_not_found" });

        // The row every pre-existing chart inherits, still whole.
        const after = await prisma.customGraph.findFirst({
          where: { id: builder.id, projectId: project.id },
        });
        expect(after?.kind).toBe(BUILDER_CHART_KIND);
        expect(after?.graph).toEqual({
          series: [{ metric: "metadata.trace_id" }],
        });
      });
    });

    describe("when a builder read path looks up the saved workbench chart", () => {
      /** @scenario "A saved workbench chart is not readable as a builder chart" */
      it("does not find it, and still finds the builder chart beside it", async () => {
        const saved = await save();
        const builder = await prisma.customGraph.create({
          data: {
            projectId: project.id,
            name: "A builder chart",
            graph: { series: [{ metric: "metadata.trace_id" }] },
          },
        });

        // A real builder reader against the real database — the automations
        // repository, which reads a chart to evaluate its series. Asserting the
        // converse through one of these is what makes the isolation mutual
        // rather than a property only the workbench's own reads have.
        const builderReader = AppAutomationRuntime.create({
          database: prisma,
          redis: null,
        }).build();

        expect(
          await builderReader.tryGetCustomGraph({
            customGraphId: saved.id,
            projectId: project.id,
          }),
        ).toBeNull();
        expect(
          await builderReader.customGraphExistsInProject({
            customGraphId: saved.id,
            projectId: project.id,
          }),
        ).toBe(false);
        expect(
          await builderReader.getCustomGraphNamesByIds({
            customGraphIds: [saved.id, builder.id],
            projectId: project.id,
          }),
        ).toEqual([{ id: builder.id, name: builder.name }]);

        // Refusing to read it is not the same as damaging it.
        const after = await prisma.customGraph.findFirst({
          where: { id: saved.id, projectId: project.id },
        });
        expect(after?.kind).toBe(WORKBENCH_SQL_CHART_KIND);
      });
    });
  });

  describe("given a saved chart whose stored definition does not match the schema", () => {
    describe("when the member reads it", () => {
      /** @scenario "A stored definition that no longer matches the schema is named, not returned as data" */
      it("names the failure rather than returning a usable-looking definition", async () => {
        const corrupt = await prisma.customGraph.create({
          data: {
            projectId: project.id,
            name: "Written by a build that disagreed",
            graph: { version: 99, sql: SQL },
            kind: WORKBENCH_SQL_CHART_KIND,
          },
        });

        await expect(
          service.getById({ id: corrupt.id, projectId: project.id }),
        ).rejects.toMatchObject({
          code: "saved_workbench_chart_definition_invalid",
        });
        await expect(
          service.getAll({ projectId: project.id }),
        ).rejects.toMatchObject({
          code: "saved_workbench_chart_definition_invalid",
        });
      });
    });
  });

  describe("given a chart saved in one project", () => {
    describe("when a member of a different project reads it by its id", () => {
      /** @scenario "Another project's saved chart is not readable" */
      it("answers exactly as it would for an id that never existed", async () => {
        const saved = await save();

        await expect(
          service.getById({ id: saved.id, projectId: otherProject.id }),
        ).rejects.toMatchObject({ code: "saved_workbench_chart_not_found" });
        await expect(
          service.getById({
            id: `never-${nanoid()}`,
            projectId: otherProject.id,
          }),
        ).rejects.toMatchObject({ code: "saved_workbench_chart_not_found" });
      });
    });

    describe("when a member lists a different project's saved charts", () => {
      /** @scenario "Another project's saved charts are not listed" */
      it("lists only that project's charts", async () => {
        const mine = await save();
        const theirs = await service.createChart({
          projectId: otherProject.id,
          protections: FULLY_PERMITTED,
          input: { name: "Theirs", definition: DEFINITION },
        });

        const listed = await service.getAll({ projectId: otherProject.id });

        expect(listed.map(({ id }) => id)).toEqual([theirs.id]);
        expect(listed.map(({ id }) => id)).not.toContain(mine.id);
      });
    });

    describe("when a member of a different project updates or deletes it", () => {
      /** @scenario "Another project's saved chart cannot be edited or deleted" */
      it("refuses both as not found and leaves the chart exactly as it was", async () => {
        const saved = await save();

        await expect(
          service.updateChart({
            id: saved.id,
            projectId: otherProject.id,
            protections: FULLY_PERMITTED,
            input: { name: "Renamed by a stranger" },
          }),
        ).rejects.toMatchObject({ code: "saved_workbench_chart_not_found" });
        await expect(
          service.deleteChart({ id: saved.id, projectId: otherProject.id }),
        ).rejects.toMatchObject({ code: "saved_workbench_chart_not_found" });

        const after = await service.getById({
          id: saved.id,
          projectId: project.id,
        });
        expect(after.name).toBe("Traces per day");
        expect(after.definition).toEqual(saved.definition);
      });
    });
  });

  describe("given a chart the member owns", () => {
    describe("when they edit and then delete it", () => {
      it("stores the new definition and then stops finding the chart", async () => {
        const saved = await save();

        const updated = await service.updateChart({
          id: saved.id,
          projectId: project.id,
          protections: FULLY_PERMITTED,
          input: {
            name: "Traces per week",
            definition: { ...DEFINITION, vegaLiteSpec: undefined },
          },
        });
        expect(updated.name).toBe("Traces per week");
        expect(updated.definition.vegaLiteSpec).toBeUndefined();

        // Read the row back so the assertion covers the persisted JSON, not
        // just the object the update call answered with.
        const reread = await service.getById({
          id: saved.id,
          projectId: project.id,
        });
        expect(reread.definition.vegaLiteSpec).toBeUndefined();

        await service.deleteChart({ id: saved.id, projectId: project.id });

        await expect(
          service.getById({ id: saved.id, projectId: project.id }),
        ).rejects.toMatchObject({ code: "saved_workbench_chart_not_found" });
      });
    });
  });
});
