/**
 * @vitest-environment node
 *
 * Scenario field values against a real database: a scenario carries one
 * value per field its test suite declares, checked and stored in the field's
 * own type, and a blank value clears the field.
 *
 * @see specs/scenarios/scenario-fields.feature
 */
import { nanoid } from "nanoid";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";
import {
  ScenarioFieldTypeInvalidError,
  ScenarioFieldUnknownError,
} from "../errors";
import { ScenarioService } from "../scenario.service";

const projectId = `test-scenario-fields-${nanoid(8)}`;

const service = ScenarioService.create(prisma);

async function createTestSuite() {
  return prisma.simulationSuite.create({
    data: {
      projectId,
      name: `Case lookups ${nanoid(6)}`,
      slug: `case-lookups-${nanoid(6)}`,
      kind: "test_suite",
      scenarioIds: [],
      targets: [],
      fields: [
        { identifier: "golden_sql", type: "text" },
        { identifier: "max_rows", type: "number" },
        { identifier: "needs_approval", type: "boolean" },
      ],
    },
  });
}

async function createCase({
  testSuiteId,
  fields,
}: {
  testSuiteId: string;
  fields?: Record<string, string | number | boolean>;
}) {
  return service.create(
    {
      projectId,
      name: "Chargebacks by quarter",
      situation: "An analyst asks for chargebacks per quarter",
      criteria: ["The agent answers"],
      labels: [],
      testSuiteId,
      ...(fields !== undefined && { fields }),
    },
    { actor: { userId: null, label: "api" } },
  );
}

beforeAll(async () => {
  await getTestUser();
  const organization = await prisma.organization.findUnique({
    where: { slug: "test-organization" },
  });
  const team = await prisma.team.findFirst({
    where: { slug: "test-team", organizationId: organization!.id },
  });
  await prisma.project.upsert({
    where: { id: projectId },
    update: {},
    create: {
      id: projectId,
      name: projectId,
      slug: projectId,
      apiKey: `sk-lw-${projectId}`,
      teamId: team!.id,
      language: "en",
      framework: "test",
    },
  });
});

beforeEach(async () => {
  await prisma.scenarioVersion.deleteMany({ where: { projectId } });
  await prisma.scenario.deleteMany({ where: { projectId } });
  await prisma.simulationSuite.deleteMany({ where: { projectId } });
});

describe("scenario field values", () => {
  describe("given a test suite declaring typed fields", () => {
    describe("when a scenario is saved with a value per field", () => {
      /** @scenario "A scenario carries a value per suite field" */
      it("stores each value in the field's own type and reads it back", async () => {
        const testSuite = await createTestSuite();

        const scenario = await createCase({
          testSuiteId: testSuite.id,
          fields: {
            golden_sql: "SELECT 1",
            max_rows: "12",
            needs_approval: "yes",
          },
        });

        const stored = await service.getById({
          id: scenario.id,
          projectId,
        });
        expect(stored?.fields).toEqual({
          golden_sql: "SELECT 1",
          max_rows: 12,
          needs_approval: true,
        });
      });
    });

    describe("when a scenario is saved with a value for a field the suite does not declare", () => {
      /** @scenario "A value for a field the suite does not declare is refused" */
      it("refuses with scenario_field_unknown and stores nothing", async () => {
        const testSuite = await createTestSuite();

        await expect(
          createCase({
            testSuiteId: testSuite.id,
            fields: { table_schema: "CREATE TABLE ..." },
          }),
        ).rejects.toBeInstanceOf(ScenarioFieldUnknownError);
        expect(await prisma.scenario.count({ where: { projectId } })).toBe(0);
      });
    });

    describe("when a scenario is saved with a value of the wrong type", () => {
      /** @scenario "A value of the wrong type is refused" */
      it("refuses with scenario_field_type_invalid", async () => {
        const testSuite = await createTestSuite();

        await expect(
          createCase({
            testSuiteId: testSuite.id,
            fields: { max_rows: "twelve" },
          }),
        ).rejects.toBeInstanceOf(ScenarioFieldTypeInvalidError);
      });
    });

    describe("when a value is saved blank", () => {
      /** @scenario "A blank value clears the field on the scenario" */
      it("drops the field from the stored values", async () => {
        const testSuite = await createTestSuite();
        const scenario = await createCase({
          testSuiteId: testSuite.id,
          fields: { golden_sql: "SELECT 1", max_rows: 12 },
        });

        const updated = await service.update({
          id: scenario.id,
          projectId,
          data: { fields: { golden_sql: "", max_rows: 12 } },
        });

        expect(updated.fields).toEqual({ max_rows: 12 });
      });
    });

    describe("when a scenario moves to a suite that declares other fields", () => {
      it("checks the values against the suite it moves to", async () => {
        const from = await createTestSuite();
        const to = await prisma.simulationSuite.create({
          data: {
            projectId,
            name: `Other ${nanoid(6)}`,
            slug: `other-${nanoid(6)}`,
            kind: "test_suite",
            scenarioIds: [],
            targets: [],
            fields: [{ identifier: "table_schema", type: "text" }],
          },
        });
        const scenario = await createCase({
          testSuiteId: from.id,
          fields: { golden_sql: "SELECT 1" },
        });

        await expect(
          service.update({
            id: scenario.id,
            projectId,
            data: { testSuiteId: to.id, fields: { golden_sql: "SELECT 1" } },
          }),
        ).rejects.toBeInstanceOf(ScenarioFieldUnknownError);

        const moved = await service.update({
          id: scenario.id,
          projectId,
          data: { testSuiteId: to.id, fields: { table_schema: "CREATE" } },
        });
        expect(moved.testSuiteId).toBe(to.id);
        expect(moved.fields).toEqual({ table_schema: "CREATE" });
      });
    });
  });
});
