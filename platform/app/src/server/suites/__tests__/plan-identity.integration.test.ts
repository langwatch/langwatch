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
import type { RunParameterValues } from "~/server/scenarios/parameters";
import { getTestUser } from "../../../utils/testUtils";
import { AgentRepository } from "../../agents/agent.repository";
import { prisma } from "../../db";
import { LlmConfigRepository } from "../../prompt-config/repositories/llm-config.repository";
import { ScenarioRepository } from "../../scenarios/scenario.repository";
import { ScenarioService } from "../../scenarios/scenario.service";
import { CLI_EPHEMERAL_LABEL } from "../constants";
import { sortSuiteTargets } from "../plan-config";
import type { SuiteScope } from "../scope";
import { SuiteRepository } from "../suite.repository";
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

/** A case whose run needs a credential supplied when the run starts. */
async function createSecretCase(name: string) {
  return scenarioService.create({
    projectId,
    name,
    situation: "The agent calls the billing API",
    criteria: ["The agent calls the API"],
    labels: [],
    parameters: [{ name: "api_token", secret: true }],
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
  /** The scenarios a hand-picked scope covers. */
  scenarioIds?: string[];
  /** Values supplied for the run's declared parameters. */
  parameters?: RunParameterValues;
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
      ...(params.scenarioIds !== undefined && {
        scenarioIds: params.scenarioIds,
      }),
    },
    idempotencyKey: `run-${nanoid(6)}`,
    ...(params.parameters !== undefined && { parameters: params.parameters }),
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

/** The runs the suite-run pipeline was asked to start, in order. */
function startedRuns() {
  return startSuiteRun.mock.calls.map(([data]) => data);
}

describe("a run of one scenario", () => {
  /**
   * A run of one scenario is an ordinary run plan: the name the app derives is
   * the scenario name and the agent, so pressing Run again on the same row
   * against the same agent joins the plan the first run created and stacks a
   * second run on it.
   */
  describe("when the same scenario runs twice against the same agent", () => {
    /** @scenario "Two runs of one scenario against one agent stack on one plan" */
    it("keeps one plan of that name and files both runs under it", async () => {
      const testCase = await createCase("Angry refund request");
      const agent = await createHttpAgent();
      const name = "Angry refund request prod-agent";

      const first = await runUnderName({
        name,
        scope: { mode: "cases" },
        scenarioIds: [testCase.id],
        targets: [{ type: "http", referenceId: agent.id }],
      });
      const second = await runUnderName({
        name,
        scope: { mode: "cases" },
        scenarioIds: [testCase.id],
        targets: [{ type: "http", referenceId: agent.id }],
      });

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.suiteId).toBe(first.suiteId);

      const plans = await plansNamed(name);
      expect(plans).toHaveLength(1);
      expect(plans[0]!.scenarioIds).toEqual([testCase.id]);

      // Two runs, one plan: the plan's run list is what grows a trend.
      const runs = startedRuns();
      expect(runs).toHaveLength(2);
      expect(runs.map((run) => run.suiteId)).toEqual([
        first.suiteId,
        first.suiteId,
      ]);
      expect(new Set(runs.map((run) => run.scenarioSetId)).size).toBe(1);
      expect(runs[0]!.batchRunId).not.toBe(runs[1]!.batchRunId);
      expect(runs.map((run) => run.scenarioIds)).toEqual([
        [testCase.id],
        [testCase.id],
      ]);
    });
  });

  describe("when the same scenario runs against another agent", () => {
    /** @scenario "Running one scenario against another agent creates a second plan" */
    it("creates a second plan under the other name", async () => {
      const testCase = await createCase("Angry refund request");
      const prod = await createHttpAgent();
      const dev = await createHttpAgent();

      const first = await runUnderName({
        name: "Angry refund request prod-agent",
        scope: { mode: "cases" },
        scenarioIds: [testCase.id],
        targets: [{ type: "http", referenceId: prod.id }],
      });
      const second = await runUnderName({
        name: "Angry refund request dev-agent",
        scope: { mode: "cases" },
        scenarioIds: [testCase.id],
        targets: [{ type: "http", referenceId: dev.id }],
      });

      expect(second.created).toBe(true);
      expect(second.suiteId).not.toBe(first.suiteId);

      const prodPlan = (
        await plansNamed("Angry refund request prod-agent")
      )[0]!;
      const devPlan = (await plansNamed("Angry refund request dev-agent"))[0]!;
      expect(prodPlan.scenarioIds).toEqual([testCase.id]);
      expect(devPlan.scenarioIds).toEqual([testCase.id]);
      expect(prodPlan.targets).toEqual([
        { type: "http", referenceId: prod.id },
      ]);
      expect(devPlan.targets).toEqual([{ type: "http", referenceId: dev.id }]);
    });
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

    /** @scenario "A run started with no name is named after its scope and targets" */
    it("names a run that sends no name after its scope and its targets", async () => {
      const refunds = await suiteService.createFolder({
        projectId,
        name: "Refunds",
      });
      // A second suite keeps the scope a folders scope: naming every suite of
      // the project is the same thing as "all scenarios".
      await suiteService.createFolder({ projectId, name: "Checkout" });
      await createCase("One", refunds.id);
      const first = await createHttpAgent();
      const second = await createHttpAgent();
      const targets: SuiteTarget[] = [
        { type: "http", referenceId: first.id },
        { type: "http", referenceId: second.id },
      ];

      const result = await suiteService.runPlan({
        projectId,
        organizationId,
        config: {
          scope: { mode: "folders", folderIds: [refunds.id] },
          targets,
        },
        idempotencyKey: `run-${nanoid(6)}`,
      });

      const nameOf = new Map([
        [first.id, first.name],
        [second.id, second.name],
      ]);
      const expected = `Refunds ${sortSuiteTargets(targets)
        .map((target) => nameOf.get(target.referenceId))
        .join(" vs ")}`;
      expect(result.created).toBe(true);
      expect(result.planName).toBe(expected);

      // The same run started again resolves the same name, so it joins the
      // plan the first one created.
      const again = await suiteService.runPlan({
        projectId,
        organizationId,
        config: {
          scope: { mode: "folders", folderIds: [refunds.id] },
          targets,
        },
        idempotencyKey: `run-${nanoid(6)}`,
      });

      expect(again.created).toBe(false);
      expect(again.suiteId).toBe(result.suiteId);
      expect(await plansNamed(expected)).toHaveLength(1);
    });

    /** @scenario "A test suite does not answer to a run plan name" */
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

  /**
   * The run is resolved in full before the plan row is written, so a run the
   * platform refuses writes nothing at all: it creates no plan, and it does
   * not replace the config of the plan its name matches.
   */
  describe("when the run is refused", () => {
    /** @scenario "A run refused for a missing secret value creates no plan" */
    it("creates no plan when a declared secret has no value", async () => {
      const secretCase = await createSecretCase("Billing check");
      const agent = await createHttpAgent();

      await expect(
        runUnderName({
          name: "Billing nightly",
          scope: { mode: "cases" },
          scenarioIds: [secretCase.id],
          targets: [{ type: "http", referenceId: agent.id }],
        }),
      ).rejects.toMatchObject({ code: "scenario_secret_parameter_missing" });

      expect(await plansNamed("Billing nightly")).toHaveLength(0);
      expect(startSuiteRun).not.toHaveBeenCalled();
    });

    /** @scenario "A run refused for a missing secret value leaves the plan it names unchanged" */
    it("leaves the config of the plan it names exactly as it was", async () => {
      const first = await createCase("One");
      const dev = await createHttpAgent();
      await runUnderName({
        name: "Nightly",
        scope: { mode: "cases" },
        scenarioIds: [first.id],
        targets: [{ type: "http", referenceId: dev.id }],
      });
      const before = (await plansNamed("Nightly"))[0]!;

      const secretCase = await createSecretCase("Billing check");
      const prod = await createHttpAgent();
      await expect(
        runUnderName({
          name: "Nightly",
          scope: { mode: "cases" },
          scenarioIds: [secretCase.id],
          targets: [{ type: "http", referenceId: prod.id }],
          repeatCount: 3,
        }),
      ).rejects.toMatchObject({ code: "scenario_secret_parameter_missing" });

      const after = (await plansNamed("Nightly"))[0]!;
      expect(after.scenarioIds).toEqual([first.id]);
      expect(after.targets).toEqual([{ type: "http", referenceId: dev.id }]);
      expect(after.repeatCount).toBe(before.repeatCount);
      // Nothing was written at all, so the row was never even touched.
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect(startSuiteRun).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A run refused for naming no target creates no plan" */
    it("creates no plan when the run names no target", async () => {
      await createCase("One");

      await expect(
        runUnderName({
          name: "Targetless",
          scope: { mode: "all" },
          targets: [],
        }),
      ).rejects.toMatchObject({ code: "suite_targets_required" });

      expect(await plansNamed("Targetless")).toHaveLength(0);
      expect(startSuiteRun).not.toHaveBeenCalled();
    });

    /** @scenario "A run refused for covering no scenario creates no plan" */
    it("creates no plan when the scope covers no case", async () => {
      await createCase("One");
      const agent = await createHttpAgent();

      await expect(
        runUnderName({
          name: "Checkout nightly",
          scope: { mode: "labels", labels: ["checkout"] },
          targets: [{ type: "http", referenceId: agent.id }],
        }),
      ).rejects.toMatchObject({ code: "suite_scope_empty" });

      expect(await plansNamed("Checkout nightly")).toHaveLength(0);
      expect(startSuiteRun).not.toHaveBeenCalled();
    });

    /** @scenario "A run that supplies the secret value creates its plan and starts" */
    it("creates the plan and starts the run when the secret has a value", async () => {
      const secretCase = await createSecretCase("Billing check");
      const agent = await createHttpAgent();

      const result = await runUnderName({
        name: "Billing nightly",
        scope: { mode: "cases" },
        scenarioIds: [secretCase.id],
        targets: [{ type: "http", referenceId: agent.id }],
        parameters: { api_token: "a-token" },
      });

      expect(result.created).toBe(true);
      const plans = await plansNamed("Billing nightly");
      expect(plans).toHaveLength(1);
      expect(plans[0]!.scenarioIds).toEqual([secretCase.id]);
      expect(startedRuns()).toHaveLength(1);
    });
  });
});

/**
 * A service whose name lookup is slow, so every run of a name no plan holds
 * yet reads "nothing here" before any of them writes. Real concurrency alone
 * does not reproduce that reliably: the lookup answers in under a millisecond,
 * so runs started together still tend to fall into line. The delay sits
 * between the read and the write the read decides, which is the window the
 * name lock closes.
 */
function serviceWithSlowNameLookup(delayMs: number): SuiteService {
  const repository = new SuiteRepository(prisma);
  const slowRepository = new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      const method = value.bind(target);
      if (property !== "findPlanByName") return method;
      return async (...args: unknown[]) => {
        const found = await (method as (...a: unknown[]) => Promise<unknown>)(
          ...args,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return found;
      };
    },
  });

  return new SuiteService(
    slowRepository,
    new ScenarioRepository(prisma),
    new AgentRepository(prisma),
    new LlmConfigRepository(prisma),
    SuiteRunService.create({
      resolveClickHouseClient: null,
      startSuiteRun,
      queueSimulationRun,
    }),
    prisma,
  );
}

describe("when runs of one name start together", () => {
  /**
   * The name is the plan contract, so it has to hold under concurrency too.
   * A CI job that starts the REST API, the CLI and the MCP server on one
   * derived name has every caller read "no plan of this name" at the same
   * moment, and each of them would then insert its own.
   */
  /** @scenario "Concurrent first runs of one name create one plan" */
  it("creates the plan once and files every run under it", async () => {
    const testCase = await createCase("Angry refund request");
    const agent = await createHttpAgent();
    const name = "Refunds prod-agent";
    suiteService = serviceWithSlowNameLookup(150);

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        runUnderName({
          name,
          scope: { mode: "cases" },
          scenarioIds: [testCase.id],
          targets: [{ type: "http", referenceId: agent.id }],
        }),
      ),
    );

    const plans = await plansNamed(name);
    expect(plans).toHaveLength(1);

    // One run created the plan, the rest joined the one it created.
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.suiteId))).toEqual(
      new Set([plans[0]!.id]),
    );
    expect(startedRuns()).toHaveLength(4);
  });
});
