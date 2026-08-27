/**
 * @vitest-environment node
 *
 * A run plan is identified by its NAME: a run started under a name joins the
 * plan of that name and replaces its config, or creates the plan.
 *
 * @see specs/suites/run-plan-identity-by-name.feature
 */
import { nanoid } from "nanoid";
import type { Mock } from "vitest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "~/generated/prisma/client";
import { SuiteRunService } from "~/server/app-layer/suites/suite-run.service";
import type { QueueRunCommandData } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/commands";
import type { StartSuiteRunCommandData } from "~/server/event-sourcing/pipelines/suite-run-processing/schemas/commands";
import { getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { ScenarioService } from "../../scenarios/scenario.service";
import { CLI_EPHEMERAL_LABEL } from "../constants";
import type { SuiteScope } from "../scope";
import { SuiteService } from "../suite.service";
import type { SuiteTarget } from "../types";

const projectId = `test-plan-identity-${nanoid(8)}`;
const organizationId = "test-plan-identity-org";

let startSuiteRun: Mock<(data: StartSuiteRunCommandData) => Promise<void>>;
let queueSimulationRun: Mock<(data: QueueRunCommandData) => Promise<void>>;
let suiteService: SuiteService;
const scenarioService = ScenarioService.create(prisma);

async function createCase(name: string, folderId?: string) {
  return scenarioService.create({
    projectId,
    name,
    situation: "A customer asks for help",
    criteria: ["The agent helps"],
    labels: [],
    ...(folderId !== undefined && { folderId }),
  });
}

async function createHttpAgent(): Promise<Agent> {
  return prisma.agent.create({
    data: {
      projectId,
      name: `Agent ${nanoid(4)}`,
      type: "http",
      config: {
        url: "https://example.com/chat",
        method: "POST",
        headers: [],
        bodyTemplate: '{"message": "{{input}}"}',
      },
    },
  });
}

/** Starts a run under a name, with the pieces every case here needs. */
async function runUnderName(params: {
  name: string;
  scope: SuiteScope;
  targets: SuiteTarget[];
  repeatCount?: number;
}) {
  return suiteService.runPlan({
    projectId,
    organizationId,
    name: params.name,
    config: {
      scope: params.scope,
      targets: params.targets,
      ...(params.repeatCount !== undefined && {
        repeatCount: params.repeatCount,
      }),
    },
    idempotencyKey: `run-${nanoid(6)}`,
  });
}

async function plansNamed(name: string) {
  return prisma.simulationSuite.findMany({
    where: { projectId, kind: "custom", name, archivedAt: null },
  });
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
  await prisma.scenario.deleteMany({ where: { projectId } });
  await prisma.simulationSuite.deleteMany({ where: { projectId } });
  await prisma.agent.deleteMany({ where: { projectId } });
  startSuiteRun = vi.fn(async () => {});
  queueSimulationRun = vi.fn(async () => {});
  suiteService = SuiteService.create({
    prisma,
    suiteRunService: SuiteRunService.create({
      resolveClickHouseClient: null,
      startSuiteRun,
      queueSimulationRun,
    }),
  });
});

describe("resolving a run plan by name", () => {
  describe("when no plan answers to the name", () => {
    /** @scenario "A run whose name matches no plan creates one" */
    it("creates a plan carrying the scope and targets the run was started with", async () => {
      await createCase("One");
      const agent = await createHttpAgent();

      const result = await runUnderName({
        name: "Refunds prod-agent",
        scope: { mode: "all" },
        targets: [{ type: "http", referenceId: agent.id }],
      });

      expect(result.created).toBe(true);
      expect(result.planName).toBe("Refunds prod-agent");
      const plans = await plansNamed("Refunds prod-agent");
      expect(plans).toHaveLength(1);
      expect(plans[0]!.scope).toEqual({ mode: "all" });
      expect(plans[0]!.targets).toEqual([
        { type: "http", referenceId: agent.id },
      ]);
      expect(result.suiteId).toBe(plans[0]!.id);
    });

    /** @scenario "A new plan whose name slugifies to a taken slug gets a numbered slug" */
    it("takes a numbered slug when the name's slug is already used", async () => {
      await createCase("One");
      const agent = await createHttpAgent();
      await suiteService.createFolder({ projectId, name: "Nightly" });

      await runUnderName({
        name: "Nightly",
        scope: { mode: "all" },
        targets: [{ type: "http", referenceId: agent.id }],
      });

      const plans = await plansNamed("Nightly");
      expect(plans).toHaveLength(1);
      expect(plans[0]!.slug).toBe("nightly-2");
    });
  });

  describe("when a plan already answers to the name", () => {
    /** @scenario "A run whose name matches a plan joins it and replaces its config" */
    it("joins the plan and replaces its config", async () => {
      await createCase("One");
      const folder = await suiteService.createFolder({
        projectId,
        name: "Refunds",
      });
      await createCase("Two", folder.id);
      const dev = await createHttpAgent();
      const prod = await createHttpAgent();

      const first = await runUnderName({
        name: "Nightly",
        scope: { mode: "folders", folderIds: [folder.id] },
        targets: [{ type: "http", referenceId: dev.id }],
      });
      const second = await runUnderName({
        name: "Nightly",
        scope: { mode: "all" },
        targets: [{ type: "http", referenceId: prod.id }],
      });

      expect(second.created).toBe(false);
      expect(second.suiteId).toBe(first.suiteId);
      expect(await plansNamed("Nightly")).toHaveLength(1);
      const plan = (await plansNamed("Nightly"))[0]!;
      expect(plan.scope).toEqual({ mode: "all" });
      expect(plan.targets).toEqual([{ type: "http", referenceId: prod.id }]);
    });

    /** @scenario "The name is matched trimmed and without regard to case" */
    it("matches trimmed and without regard to case", async () => {
      await createCase("One");
      const agent = await createHttpAgent();

      const first = await runUnderName({
        name: "Nightly",
        scope: { mode: "all" },
        targets: [{ type: "http", referenceId: agent.id }],
      });
      const second = await runUnderName({
        name: "  nightly  ",
        scope: { mode: "all" },
        targets: [{ type: "http", referenceId: agent.id }],
      });

      expect(second.suiteId).toBe(first.suiteId);
      expect(second.created).toBe(false);
      // The plan keeps the spelling it was created with. A match made without
      // regard to case must not rename it to the caller's spelling.
      expect(await plansNamed("Nightly")).toHaveLength(1);
      expect(second.planName).toBe("Nightly");
    });

    /** @scenario "Replacing a plan's config does not rename the plan" */
    /** @scenario "Replacing a plan's config keeps its slug" */
    it("keeps the plan's name and slug when its config is replaced", async () => {
      await createCase("One");
      const folder = await suiteService.createFolder({
        projectId,
        name: "Refunds",
      });
      await createCase("Two", folder.id);
      const agent = await createHttpAgent();

      const first = await runUnderName({
        name: "Nightly",
        scope: { mode: "folders", folderIds: [folder.id] },
        targets: [{ type: "http", referenceId: agent.id }],
      });
      const slugBefore = (await plansNamed("Nightly"))[0]!.slug;

      await runUnderName({
        name: "Nightly",
        scope: { mode: "all" },
        targets: [{ type: "http", referenceId: agent.id }],
      });

      const plan = (await plansNamed("Nightly"))[0]!;
      expect(plan.name).toBe("Nightly");
      expect(plan.slug).toBe(slugBefore);

      // And it still answers to the name on the next run.
      const third = await runUnderName({
        name: "Nightly",
        scope: { mode: "all" },
        targets: [{ type: "http", referenceId: agent.id }],
      });
      expect(third.suiteId).toBe(first.suiteId);
    });

    /** @scenario "An archived plan does not answer to its name" */
    it("ignores an archived plan of the same name", async () => {
      await createCase("One");
      const agent = await createHttpAgent();

      const first = await runUnderName({
        name: "Nightly",
        scope: { mode: "all" },
        targets: [{ type: "http", referenceId: agent.id }],
      });
      await suiteService.archive({ id: first.suiteId, projectId });

      const second = await runUnderName({
        name: "Nightly",
        scope: { mode: "all" },
        targets: [{ type: "http", referenceId: agent.id }],
      });

      expect(second.created).toBe(true);
      expect(second.suiteId).not.toBe(first.suiteId);
      const archived = await prisma.simulationSuite.findFirst({
        where: { id: first.suiteId, projectId },
      });
      expect(archived?.archivedAt).not.toBeNull();
    });

    /** @scenario "A folder-kind suite does not answer to a run plan name" */
    it("ignores a folder of the same name", async () => {
      await createCase("One");
      const agent = await createHttpAgent();
      const folder = await suiteService.createFolder({
        projectId,
        name: "Refunds",
      });

      const result = await runUnderName({
        name: "Refunds",
        scope: { mode: "all" },
        targets: [{ type: "http", referenceId: agent.id }],
      });

      expect(result.created).toBe(true);
      expect(result.suiteId).not.toBe(folder.id);
      const unchanged = await prisma.simulationSuite.findFirst({
        where: { id: folder.id, projectId },
      });
      expect(unchanged?.kind).toBe("folder");
      expect(unchanged?.targets).toEqual([]);
    });

    /** @scenario "The command line's throwaway suite does not answer to its name" */
    it("ignores the command line's throwaway suite of the same name", async () => {
      await createCase("One");
      const agent = await createHttpAgent();
      const ephemeral = await suiteService.create({
        projectId,
        name: "CLI run",
        kind: "custom",
        scenarioIds: [],
        targets: [],
        repeatCount: 1,
        labels: [CLI_EPHEMERAL_LABEL],
      });

      const result = await runUnderName({
        name: "CLI run",
        scope: { mode: "all" },
        targets: [{ type: "http", referenceId: agent.id }],
      });

      expect(result.suiteId).not.toBe(ephemeral.id);
      expect(result.created).toBe(true);
      const untouched = await prisma.simulationSuite.findFirst({
        where: { id: ephemeral.id, projectId },
      });
      expect(untouched?.targets).toEqual([]);
      expect(untouched?.labels).toEqual([CLI_EPHEMERAL_LABEL]);
    });
  });

  describe("when two plans share a config", () => {
    /** @scenario "Two plans may share a config and differ only by name" */
    it("keeps them apart by name", async () => {
      await createCase("One");
      const agent = await createHttpAgent();
      const scope: SuiteScope = { mode: "all" };
      const targets: SuiteTarget[] = [{ type: "http", referenceId: agent.id }];

      const nightly = await runUnderName({ name: "Nightly", scope, targets });
      const release = await runUnderName({
        name: "Release check",
        scope,
        targets,
      });

      expect(release.suiteId).not.toBe(nightly.suiteId);
      expect(await plansNamed("Nightly")).toHaveLength(1);
      expect(await plansNamed("Release check")).toHaveLength(1);
    });
  });

  describe("when the scope names every suite of the project", () => {
    /** @scenario "Naming every suite of the project resolves to the same plan as running everything" */
    it("stores the scope as all, so it lands where Run all lands", async () => {
      const agent = await createHttpAgent();
      const refunds = await suiteService.createFolder({
        projectId,
        name: "Refunds",
      });
      // Creating this one without a folder makes the project's Default suite.
      const loose = await createCase("One");
      await createCase("Two", refunds.id);

      const everything = await runUnderName({
        name: "Nightly",
        scope: {
          mode: "folders",
          folderIds: [refunds.id, loose.folderId!],
        },
        targets: [{ type: "http", referenceId: agent.id }],
      });

      const plan = (await plansNamed("Nightly"))[0]!;
      expect(plan.scope).toEqual({ mode: "all" });
      expect(everything.created).toBe(true);

      // And Run all under the same name joins it rather than forking.
      const runAll = await runUnderName({
        name: "Nightly",
        scope: { mode: "all" },
        targets: [{ type: "http", referenceId: agent.id }],
      });
      expect(runAll.suiteId).toBe(everything.suiteId);
      expect(await plansNamed("Nightly")).toHaveLength(1);
    });
  });

  describe("when the name is empty", () => {
    /** @scenario "A run started under an empty name is refused" */
    it("refuses the run and creates no plan", async () => {
      await createCase("One");
      const agent = await createHttpAgent();

      await expect(
        runUnderName({
          name: "   ",
          scope: { mode: "all" },
          targets: [{ type: "http", referenceId: agent.id }],
        }),
      ).rejects.toMatchObject({ code: "validation_error" });

      const plans = await prisma.simulationSuite.findMany({
        where: { projectId, kind: "custom" },
      });
      expect(plans).toHaveLength(0);
      expect(startSuiteRun).not.toHaveBeenCalled();
    });
  });
});
