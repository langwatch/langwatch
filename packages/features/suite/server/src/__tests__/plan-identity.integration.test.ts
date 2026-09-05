/**
 * @vitest-environment node
 *
 * A run plan is identified by its NAME: a run started under a name joins the
 * plan of that name and replaces its config, or creates the plan.
 *
 * Ported from platform/app/src/server/suites/__tests__/plan-identity.integration.test.ts
 * (origin/main), adapted to the split feature-package architecture: the
 * name-matching/locking behaviour lives in `PrismaSuiteRepository`
 * (`findOrCreatePlanByName`), used here for real against Postgres. The
 * `ScenarioService`/`AgentService`/`PromptService` collaborators `SuiteService`
 * depends on are faked (scenarios/test-suites are read straight off the same
 * database so scope resolution — which the repository does with raw Prisma
 * queries — stays real; agents and prompts are boundary services with no
 * bearing on plan identity, so they are in-memory).
 *
 * @see specs/suites/run-plan-identity-by-name.feature
 */
import { randomUUID } from "node:crypto";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AgentService } from "@langwatch/agent-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import {
  resolveRunParameters,
  scenarioRunConfigSchema,
  ScenarioSecretParameterMissingError,
  type ScenarioService,
  type ScenarioRunConfig,
  type ScenarioTestSuite,
} from "@langwatch/scenario-contract";
import {
  CLI_EPHEMERAL_LABEL,
  sortSuiteTargets,
  type SuiteRunResult,
  type SuiteScope,
  type SuiteTarget,
} from "@langwatch/suite-contract";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { SuiteExecutionPort } from "../ports/suite-execution.port";
import { PrismaSuiteRepository } from "../repositories/prisma/prisma.suite.repository";
import { MemorySuiteRunRepository } from "../repositories/memory/memory.suite-run.repository";
import { SuiteService } from "../services/suite.service";

class AllowTestQueries extends PrismaQueryGuard {
  execute(_context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(_context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (connection === null) {
    throw new Error("DATABASE_URL is required for plan identity integration tests");
  }
  return connection.client;
}

const namespace = `plan-identity-${randomUUID()}`;
let organizationId = "";
let teamId = "";
let projectId = "";

/** An in-memory agent, standing in for the real Agent table: targets are
 * stored as opaque JSON on the suite row, so nothing here needs a real FK. */
type FakeAgent = { id: string; name: string; type: "http" };

function fakeAgentService(agents: Map<string, FakeAgent>): AgentService {
  return {
    getReferenceStates: async ({ ids }: { ids: string[] }) =>
      ids.flatMap((id) => {
        const agent = agents.get(id);
        return agent ? [{ id, archivedAt: null, type: agent.type, name: agent.name }] : [];
      }),
    getNamesByIds: async ({ ids }: { ids: string[] }) =>
      ids.flatMap((id) => {
        const agent = agents.get(id);
        return agent ? [{ id, name: agent.name }] : [];
      }),
    getConnectedByNameAndEnvironment: async () => [],
    ownersOf: async () => new Map(),
  } as unknown as AgentService;
}

function fakePromptService(): PromptService {
  return {
    getExistingIds: async () => [],
    getNamesByIds: async () => [],
  } as unknown as PromptService;
}

/** Backed by the same database the repository reads: scope resolution and
 * test-suite/scenario references are real, not re-implemented. */
function fakeScenarioService(): ScenarioService {
  return {
    tryGetTestSuite: async ({ testSuiteId, projectId: pid }: { testSuiteId: string; projectId: string }) => {
      const row = await database().simulationSuite.findFirst({
        where: { id: testSuiteId, projectId: pid, kind: "test_suite" },
      });
      return row ? (row as unknown as ScenarioTestSuite) : null;
    },
    listTestSuites: async ({ projectId: pid }: { projectId: string }) => {
      const rows = await database().simulationSuite.findMany({
        where: { projectId: pid, kind: "test_suite", archivedAt: null },
      });
      return rows as unknown as ScenarioTestSuite[];
    },
    getReferenceStates: async ({ ids, projectId: pid }: { ids: string[]; projectId: string }) => {
      if (ids.length === 0) return [];
      const rows = await database().scenario.findMany({
        where: { id: { in: ids }, projectId: pid },
        select: { id: true, archivedAt: true },
      });
      return rows;
    },
    getRunConfigs: async ({ ids, projectId: pid }: { ids: string[]; projectId: string }): Promise<ScenarioRunConfig[]> => {
      if (ids.length === 0) return [];
      const rows = await database().scenario.findMany({
        where: { id: { in: ids }, projectId: pid },
        select: {
          id: true,
          name: true,
          version: true,
          situation: true,
          criteria: true,
          parameters: true,
        },
      });
      return rows.map((row) => scenarioRunConfigSchema.parse(row));
    },
    getNamesByIds: async ({ ids, projectId: pid }: { ids: string[]; projectId: string }) => {
      if (ids.length === 0) return [];
      const rows = await database().scenario.findMany({
        where: { id: { in: ids }, projectId: pid },
        select: { id: true, name: true },
      });
      return rows;
    },
    resolveRunParametersForScenarios: async ({
      scenarios,
      values,
    }: {
      scenarios: ScenarioRunConfig[];
      values?: Record<string, string | number | boolean>;
    }) => {
      // The real merge/refusal logic, unencrypted: this test never reads the
      // secret values back, only whether the run was refused.
      const resolved = await resolveRunParameters({ scenarios, values });
      return [...resolved.entries()].map(([scenarioId, resolvedValues]) => ({
        scenarioId,
        parameters: resolvedValues.parameters,
        secretParameters: resolvedValues.secretParameters,
        scenarioVersion: scenarios.find((s) => s.id === scenarioId)?.version ?? 1,
      }));
    },
  } as unknown as ScenarioService;
}

function capturingExecution(started: Array<Record<string, unknown>>): SuiteExecutionPort {
  return {
    execute: vi.fn(async (input): Promise<SuiteRunResult> => {
      started.push(input);
      return {
        batchRunId: `batch_${randomUUID()}`,
        setId: `suite:${input.suiteId}`,
        jobCount: input.activeScenarioIds.length * input.activeTargets.length * input.repeatCount,
        skippedArchived: input.skippedArchived,
        items: [],
      };
    }),
  } as unknown as SuiteExecutionPort;
}

let agents: Map<string, FakeAgent>;
let startedRuns: Array<Record<string, unknown>>;
let suiteService: SuiteService;

function buildService() {
  agents = new Map();
  startedRuns = [];
  suiteService = SuiteService.create({
    repository: PrismaSuiteRepository.create(database()),
    scenarios: fakeScenarioService(),
    agents: fakeAgentService(agents),
    prompts: fakePromptService(),
    execution: capturingExecution(startedRuns),
    runRepository: MemorySuiteRunRepository.create(),
  });
}

async function createCase(
  name: string,
  testSuiteId?: string,
  parameters?: { name: string; defaultValue?: string; secret?: boolean }[],
) {
  return database().scenario.create({
    data: {
      projectId,
      name,
      situation: "A customer asks for help",
      criteria: ["The agent helps"],
      labels: [],
      ...(testSuiteId !== undefined && { testSuiteId }),
      ...(parameters !== undefined && { parameters }),
    },
  });
}

/** A scenario whose run needs a credential supplied when the run starts. */
async function createSecretCase(name: string) {
  return database().scenario.create({
    data: {
      projectId,
      name,
      situation: "The agent calls the billing API",
      criteria: ["The agent calls the API"],
      labels: [],
      parameters: [{ name: "api_token", secret: true }],
    },
  });
}

async function createTestSuite(name: string) {
  return database().simulationSuite.create({
    data: {
      projectId,
      name,
      slug: name.toLowerCase().replace(/\s+/g, "-"),
      kind: "test_suite",
      scenarioIds: [],
      targets: [],
      repeatCount: 1,
      labels: [],
    },
  });
}

function createHttpAgent(name = `Agent ${randomUUID().slice(0, 8)}`): FakeAgent {
  const agent: FakeAgent = { id: `agent_${randomUUID()}`, name, type: "http" };
  agents.set(agent.id, agent);
  return agent;
}

async function runUnderName(params: {
  name?: string;
  scope: SuiteScope;
  targets: SuiteTarget[];
  repeatCount?: number;
  scenarioIds?: string[];
  parameters?: Record<string, string | number | boolean>;
}) {
  return suiteService.runPlan({
    projectId,
    organizationId,
    idempotencyKey: `run-${randomUUID().slice(0, 8)}`,
    ...(params.name !== undefined && { name: params.name }),
    config: {
      scope: params.scope,
      targets: params.targets,
      ...(params.repeatCount !== undefined && { repeatCount: params.repeatCount }),
      ...(params.scenarioIds !== undefined && { scenarioIds: params.scenarioIds }),
    },
    ...(params.parameters !== undefined && { parameters: params.parameters }),
  });
}

async function plansNamed(name: string) {
  return database().simulationSuite.findMany({
    where: { projectId, kind: "run_plan", name, archivedAt: null },
  });
}

describe.skipIf(!databaseUrl)("Run plan identity by name", () => {
  beforeAll(async () => {
    const db = database();
    const organization = await db.organization.create({
      data: { name: namespace, slug: namespace },
    });
    organizationId = organization.id;
    const team = await db.team.create({ data: { name: namespace, slug: namespace, organizationId } });
    teamId = team.id;
    const project = await db.project.create({
      data: {
        name: namespace,
        slug: namespace,
        apiKey: namespace,
        teamId,
        language: "en",
        framework: "test",
      },
    });
    projectId = project.id;
  });

  beforeEach(async () => {
    await database().scenario.deleteMany({ where: { projectId } });
    await database().simulationSuite.deleteMany({ where: { projectId } });
    buildService();
  });

  afterAll(async () => {
    try {
      if (projectId) {
        await database().scenario.deleteMany({ where: { projectId } });
        await database().simulationSuite.deleteMany({ where: { projectId } });
        await database().project.delete({ where: { id: projectId } });
        await database().team.delete({ where: { id: teamId } });
        await database().organization.delete({ where: { id: organizationId } });
      }
    } finally {
      await connection?.closeOnce();
    }
  });

  describe("a run of one scenario", () => {
    describe("when the same scenario runs twice against the same agent", () => {
      /** @scenario "Two runs of one scenario against one agent stack on one plan" */
      it("keeps one plan of that name and files both runs under it", async () => {
        const testCase = await createCase("Angry refund request");
        const agent = createHttpAgent();
        const name = "Angry refund request prod-agent";

        const first = await runUnderName({
          name,
          scope: { mode: "scenarios" },
          scenarioIds: [testCase.id],
          targets: [{ type: "http", referenceId: agent.id }],
        });
        const second = await runUnderName({
          name,
          scope: { mode: "scenarios" },
          scenarioIds: [testCase.id],
          targets: [{ type: "http", referenceId: agent.id }],
        });

        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(second.suiteId).toBe(first.suiteId);

        const plans = await plansNamed(name);
        expect(plans).toHaveLength(1);
        expect(plans[0]!.scenarioIds).toEqual([testCase.id]);
        expect(startedRuns).toHaveLength(2);
      });
    });

    describe("when the same scenario runs against another agent", () => {
      /** @scenario "Running one scenario against another agent creates a second plan" */
      it("creates a second plan under the other name", async () => {
        const testCase = await createCase("Angry refund request");
        const prod = createHttpAgent();
        const dev = createHttpAgent();

        const first = await runUnderName({
          name: "Angry refund request prod-agent",
          scope: { mode: "scenarios" },
          scenarioIds: [testCase.id],
          targets: [{ type: "http", referenceId: prod.id }],
        });
        const second = await runUnderName({
          name: "Angry refund request dev-agent",
          scope: { mode: "scenarios" },
          scenarioIds: [testCase.id],
          targets: [{ type: "http", referenceId: dev.id }],
        });

        expect(second.created).toBe(true);
        expect(second.suiteId).not.toBe(first.suiteId);
      });
    });
  });

  describe("resolving a run plan by name", () => {
    describe("when no plan answers to the name", () => {
      /** @scenario "A run whose name matches no plan creates one" */
      it("creates a plan carrying the scope and targets the run was started with", async () => {
        await createCase("One");
        const agent = createHttpAgent();

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
        expect(plans[0]!.targets).toEqual([{ type: "http", referenceId: agent.id }]);
        expect(result.suiteId).toBe(plans[0]!.id);
      });

      /** @scenario "A new plan whose name slugifies to a taken slug gets a numbered slug" */
      it("takes a numbered slug when the name's slug is already used", async () => {
        await createCase("One");
        const agent = createHttpAgent();
        await createTestSuite("Nightly");

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
        const testSuite = await createTestSuite("Refunds");
        await createCase("Two", testSuite.id);
        const dev = createHttpAgent();
        const prod = createHttpAgent();

        const first = await runUnderName({
          name: "Nightly",
          scope: { mode: "test_suites", testSuiteIds: [testSuite.id] },
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
        const agent = createHttpAgent();

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
        expect(await plansNamed("Nightly")).toHaveLength(1);
        expect(second.planName).toBe("Nightly");
      });

      /** @scenario "Replacing a plan's config does not rename the plan" */
      /** @scenario "Replacing a plan's config keeps its slug" */
      it("keeps the plan's name and slug when its config is replaced", async () => {
        await createCase("One");
        const testSuite = await createTestSuite("Refunds");
        await createCase("Two", testSuite.id);
        const agent = createHttpAgent();

        const first = await runUnderName({
          name: "Nightly",
          scope: { mode: "test_suites", testSuiteIds: [testSuite.id] },
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
        const agent = createHttpAgent();

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
        const archived = await database().simulationSuite.findFirst({
          where: { id: first.suiteId, projectId },
        });
        expect(archived?.archivedAt).not.toBeNull();
      });

      /** @scenario "A run named by the server labels a repeated agent with its parameters" */
      it("labels a repeated agent with its parameters when the run sends no name", async () => {
        const refunds = await createTestSuite("Refunds");
        await createTestSuite("Checkout");
        await createCase("One", refunds.id, [
          { name: "model", defaultValue: "gpt-5" },
          { name: "locale", defaultValue: "en" },
        ]);
        const agent = createHttpAgent();
        // The first target spells the declared default of "model" out, which
        // is no override: it is stored, keyed and named as "locale=de" alone.
        const targets: SuiteTarget[] = [
          { type: "http", referenceId: agent.id, runParameters: { locale: "de", model: "gpt-5-mini" } },
          { type: "http", referenceId: agent.id, runParameters: { locale: "de", model: "gpt-5" } },
        ];
        const scope: SuiteScope = { mode: "test_suites", testSuiteIds: [refunds.id] };

        const result = await runUnderName({ scope, targets });

        const expected = `Refunds ${agent.name} vs ${agent.name} · model=gpt-5-mini`;
        expect(result.created).toBe(true);
        expect(result.planName).toBe(expected);
        const stored = (await plansNamed(expected))[0]!;
        expect(sortSuiteTargets(stored.targets as SuiteTarget[])).toEqual(
          sortSuiteTargets([
            { type: "http", referenceId: agent.id, runParameters: { locale: "de" } },
            { type: "http", referenceId: agent.id, runParameters: { locale: "de", model: "gpt-5-mini" } },
          ]),
        );

        const again = await runUnderName({ scope, targets });
        expect(again.created).toBe(false);
        expect(again.suiteId).toBe(result.suiteId);
      });

      /** @scenario "A test suite does not answer to a run plan name" */
      it("ignores a test suite of the same name", async () => {
        await createCase("One");
        const agent = createHttpAgent();
        const testSuite = await createTestSuite("Refunds");

        const result = await runUnderName({
          name: "Refunds",
          scope: { mode: "all" },
          targets: [{ type: "http", referenceId: agent.id }],
        });

        expect(result.created).toBe(true);
        expect(result.suiteId).not.toBe(testSuite.id);
        const unchanged = await database().simulationSuite.findFirst({
          where: { id: testSuite.id, projectId },
        });
        expect(unchanged?.kind).toBe("test_suite");
      });

      /** @scenario "The command line's throwaway suite does not answer to its name" */
      it("ignores the command line's throwaway suite of the same name", async () => {
        await createCase("One");
        const agent = createHttpAgent();
        const ephemeral = await suiteService.create({
          projectId,
          name: "CLI run",
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
        const untouched = await database().simulationSuite.findFirst({
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
        const agent = createHttpAgent();
        const scope: SuiteScope = { mode: "all" };
        const targets: SuiteTarget[] = [{ type: "http", referenceId: agent.id }];

        const nightly = await runUnderName({ name: "Nightly", scope, targets });
        const release = await runUnderName({ name: "Release check", scope, targets });

        expect(release.suiteId).not.toBe(nightly.suiteId);
        expect(await plansNamed("Nightly")).toHaveLength(1);
        expect(await plansNamed("Release check")).toHaveLength(1);
      });
    });

    describe("when the scope names every suite of the project", () => {
      /** @scenario "Naming every suite of the project resolves to the same plan as running everything" */
      it("stores the scope as all, so it lands where Run all lands", async () => {
        const agent = createHttpAgent();
        const refunds = await createTestSuite("Refunds");
        const loose = await createCase("One");
        await createCase("Two", refunds.id);

        const everything = await runUnderName({
          name: "Nightly",
          scope: { mode: "test_suites", testSuiteIds: [refunds.id, loose.testSuiteId ?? "default"] },
          targets: [{ type: "http", referenceId: agent.id }],
        });

        const plan = (await plansNamed("Nightly"))[0]!;
        expect(plan.scope).toEqual({ mode: "all" });
        expect(everything.created).toBe(true);

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
        const agent = createHttpAgent();

        // `runPlan` parses its input with a schema before any business logic
        // runs; a name of only spaces fails that parse and never reaches the
        // service's own code. The tRPC/REST boundary is what promotes this
        // ZodError onto the handled `validation_error` channel — not tested
        // at this level.
        await expect(
          runUnderName({
            name: "   ",
            scope: { mode: "all" },
            targets: [{ type: "http", referenceId: agent.id }],
          }),
        ).rejects.toBeInstanceOf(z.ZodError);

        const plans = await database().simulationSuite.findMany({
          where: { projectId, kind: "run_plan" },
        });
        expect(plans).toHaveLength(0);
        expect(startedRuns).toHaveLength(0);
      });
    });

    describe("when the run is refused", () => {
      /** @scenario "A run refused for a missing secret value creates no plan" */
      it("creates no plan when a declared secret has no value", async () => {
        const secretCase = await createSecretCase("Billing check");
        const agent = createHttpAgent();

        await expect(
          runUnderName({
            name: "Billing nightly",
            scope: { mode: "scenarios" },
            scenarioIds: [secretCase.id],
            targets: [{ type: "http", referenceId: agent.id }],
          }),
        ).rejects.toBeInstanceOf(ScenarioSecretParameterMissingError);

        expect(await plansNamed("Billing nightly")).toHaveLength(0);
        expect(startedRuns).toHaveLength(0);
      });

      /** @scenario "A run refused for a missing secret value leaves the plan it names unchanged" */
      it("leaves the config of the plan it names exactly as it was", async () => {
        const first = await createCase("One");
        const dev = createHttpAgent();
        await runUnderName({
          name: "Nightly",
          scope: { mode: "scenarios" },
          scenarioIds: [first.id],
          targets: [{ type: "http", referenceId: dev.id }],
        });
        const before = (await plansNamed("Nightly"))[0]!;

        const secretCase = await createSecretCase("Billing check");
        const prod = createHttpAgent();
        await expect(
          runUnderName({
            name: "Nightly",
            scope: { mode: "scenarios" },
            scenarioIds: [secretCase.id],
            targets: [{ type: "http", referenceId: prod.id }],
            repeatCount: 3,
          }),
        ).rejects.toBeInstanceOf(ScenarioSecretParameterMissingError);

        const after = (await plansNamed("Nightly"))[0]!;
        expect(after.scenarioIds).toEqual([first.id]);
        expect(after.targets).toEqual([{ type: "http", referenceId: dev.id }]);
        expect(after.repeatCount).toBe(before.repeatCount);
        expect(after.updatedAt).toEqual(before.updatedAt);
        expect(startedRuns).toHaveLength(1);
      });

      /** @scenario "A run that supplies the secret value creates its plan and starts" */
      it("creates the plan and starts the run when the secret has a value", async () => {
        const secretCase = await createSecretCase("Billing check");
        const agent = createHttpAgent();

        const result = await runUnderName({
          name: "Billing nightly",
          scope: { mode: "scenarios" },
          scenarioIds: [secretCase.id],
          targets: [{ type: "http", referenceId: agent.id }],
          parameters: { api_token: "a-token" },
        });

        expect(result.created).toBe(true);
        const plans = await plansNamed("Billing nightly");
        expect(plans).toHaveLength(1);
        expect(plans[0]!.scenarioIds).toEqual([secretCase.id]);
        expect(startedRuns).toHaveLength(1);
      });
    });
  });

  describe("when runs of one name start together", () => {
    /**
     * The lock the repository takes (`pg_advisory_xact_lock`, keyed by
     * project + normalized name) is real Postgres, so real concurrent calls
     * exercise it directly — no artificial delay is needed the way main's
     * application-level race (a slowed-down repository lookup) needed one.
     */
    /** @scenario "Concurrent first runs of one name create one plan" */
    it("creates the plan once and files every run under it", async () => {
      const testCase = await createCase("Angry refund request");
      const agent = createHttpAgent();
      const name = "Refunds prod-agent";

      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          runUnderName({
            name,
            scope: { mode: "scenarios" },
            scenarioIds: [testCase.id],
            targets: [{ type: "http", referenceId: agent.id }],
          }),
        ),
      );

      const plans = await plansNamed(name);
      expect(plans).toHaveLength(1);
      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(new Set(results.map((result) => result.suiteId))).toEqual(new Set([plans[0]!.id]));
      expect(startedRuns).toHaveLength(4);
    });
  });
});
