/**
 * The three suite REST families over the REAL suite application: memory
 * repositories, the real execution service recording the commands it would
 * have queued, and the process ports a mount supplies.
 */
import type { AgentApi } from "@langwatch/agent-contract";
import {
  bindRestHeader,
  bindRestMiddleware,
  createRestRuntime,
  projectRestFacts,
  type RestErrorHandler,
  type RestMountOptions,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import {
  scenarioTestSuiteSchema,
  ScenarioTestSuiteNotFoundError,
  type ScenarioApi,
  type ScenarioRunConfig,
  type ScenarioTestSuite,
} from "@langwatch/scenario-contract";
import {
  suiteSchema,
  type StartSuiteRunCommandData,
  type Suite,
  type SuiteApi,
} from "@langwatch/suite-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { fromDate } from "@langwatch/time";

import { SuiteApp } from "../../app/suite.app.ts";
import {
  SuiteRunCommandsPort,
  SuiteRunIdPort,
  type QueueSimulationRunCommandData,
} from "../../ports/suite-execution.port.ts";
import { MemorySuiteDatabase } from "../../repositories/memory/memory.suite.database.ts";
import { MemorySuiteRepository } from "../../repositories/memory/memory.suite.repository.ts";
import { suiteSurfaceFact } from "../../rules/suite-wire-v1.rules.ts";
import { SuiteExecutionService } from "../../services/suite-execution.service.ts";
import { createRunPlansRest } from "../run-plans.rest.ts";
import { createSuitesAliasRest, suitesAliasErrorHandler } from "../suites-alias.rest.ts";
import { createTestSuitesRest } from "../test-suites.rest.ts";

/** The project every request in these suites is authenticated for. */
export const TEST_PROJECT = {
  id: "project-1",
  name: "Acme",
  slug: "acme",
  teamId: "team-1",
  organizationId: "organization-1",
  isPersonal: false,
  ownerUserId: null,
} as const;

const NOW = new Date("2026-01-01T00:00:00.000Z");

type ScenarioRow = {
  id: string;
  name: string;
  situation: string;
  criteria: string[];
  version: number;
  testSuiteId: string | null;
  archivedAt: Date | null;
};

type AgentReferenceState = Awaited<ReturnType<AgentApi["getReferenceStates"]>>[number];
type AgentRow = {
  id: string;
  name: string;
  type: NonNullable<AgentReferenceState["type"]>;
  archivedAt: Date | null;
};

/** Slug shape the suite service and the test-suite store both derive names with. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "run-plan"
  );
}

function nextAvailableSlug(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;

  for (let index = 2; index <= taken.length + 2; index += 1) {
    const candidate = `${base}-${index}`;
    if (!taken.includes(candidate)) return candidate;
  }

  throw new Error(`No slug is free for "${base}"`);
}

/**
 * The rows all three families read, with the ids a suite seeds by. The run
 * plans live in the memory database the repository reads, so a seeded plan and
 * a created one are the same row to the application.
 */
export class SuiteWorld {
  readonly scenarios = new Map<string, ScenarioRow>();
  readonly testSuites = new Map<string, ScenarioTestSuite>();
  readonly agents = new Map<string, AgentRow>();
  private sequence = 0;

  constructor(private readonly database: MemorySuiteDatabase) {}

  get plans(): Map<string, Suite> {
    return this.database.plans;
  }

  nextId(prefix: string): string {
    this.sequence += 1;

    return `${prefix}_${this.sequence}`;
  }

  /** The membership row the repository resolves a dynamic scope against. */
  private syncScenario(row: ScenarioRow): void {
    this.database.scenarios.set(row.id, {
      id: row.id,
      projectId: TEST_PROJECT.id,
      testSuiteId: row.testSuiteId,
      labels: [],
      archivedAt: row.archivedAt === null ? null : fromDate(row.archivedAt),
    });
  }

  addScenario(overrides: Partial<ScenarioRow> = {}): ScenarioRow {
    const id = overrides.id ?? this.nextId("scenario");
    const row: ScenarioRow = {
      id,
      name: overrides.name ?? `Scenario ${id}`,
      situation: overrides.situation ?? "A situation",
      criteria: overrides.criteria ?? ["criterion_1"],
      version: overrides.version ?? 1,
      testSuiteId: overrides.testSuiteId ?? null,
      archivedAt: overrides.archivedAt ?? null,
    };
    this.scenarios.set(id, row);
    this.syncScenario(row);

    return row;
  }

  /** Archives one scenario in both the rich row and the membership row. */
  archiveScenario(id: string, at: Date): void {
    const row = this.scenarios.get(id);
    if (!row) return;

    row.archivedAt = at;
    this.syncScenario(row);
  }

  addAgent(overrides: Partial<AgentRow> = {}): AgentRow {
    const id = overrides.id ?? this.nextId("agent");
    const row: AgentRow = {
      id,
      name: overrides.name ?? "dev-agent",
      type: overrides.type ?? "http",
      archivedAt: overrides.archivedAt ?? null,
    };
    this.agents.set(id, row);

    return row;
  }

  addTestSuite(overrides: { name?: string; scenarioIds?: string[] } = {}): ScenarioTestSuite {
    const id = this.nextId("suite");
    const name = overrides.name ?? "Refunds";
    const testSuite = scenarioTestSuiteSchema.parse({
      id,
      projectId: TEST_PROJECT.id,
      name,
      slug: nextAvailableSlug(
        slugify(name),
        [...this.testSuites.values()].map((one) => one.slug),
      ),
      description: null,
      scenarioIds: overrides.scenarioIds ?? [],
      targets: [],
      repeatCount: 1,
      labels: [],
      simulatorModel: null,
      judgeModel: null,
      kind: "test_suite",
      scope: null,
      archivedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    this.testSuites.set(id, testSuite);
    for (const scenarioId of testSuite.scenarioIds) {
      const scenario = this.scenarios.get(scenarioId);
      if (scenario) {
        scenario.testSuiteId = id;
        this.syncScenario(scenario);
      }
    }

    return testSuite;
  }

  /** A test suite with `count` scenarios filed into it. */
  addTestSuiteWithCases(
    name: string,
    count: number,
  ): { testSuite: ScenarioTestSuite; cases: ScenarioRow[] } {
    const cases = Array.from({ length: count }, (_, index) =>
      this.addScenario({ name: `${name} scenario ${index}` }),
    );

    return {
      testSuite: this.addTestSuite({ name, scenarioIds: cases.map((one) => one.id) }),
      cases,
    };
  }

  addPlan(overrides: Partial<Suite> = {}): Suite {
    const id = overrides.id ?? this.nextId("suite");
    const name = overrides.name ?? "Nightly";
    const plan = suiteSchema.parse({
      id,
      projectId: TEST_PROJECT.id,
      name,
      slug:
        overrides.slug ??
        nextAvailableSlug(
          slugify(name),
          [...this.plans.values()].map((one) => one.slug),
        ),
      kind: "run_plan",
      description: null,
      scenarioIds: overrides.scenarioIds ?? [this.addScenario().id],
      scope: overrides.scope ?? null,
      targets: overrides.targets ?? [{ type: "http", referenceId: this.addAgent().id }],
      repeatCount: overrides.repeatCount ?? 1,
      labels: overrides.labels ?? [],
      simulatorModel: overrides.simulatorModel ?? null,
      judgeModel: overrides.judgeModel ?? null,
      archivedAt: overrides.archivedAt ?? null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    this.plans.set(id, plan);

    return plan;
  }
}

/** The scenario half of the world, as the peer capability the suite reads. */
function memoryScenarioApi(world: SuiteWorld): ScenarioApi {
  const active = (id: string) => {
    const row = world.scenarios.get(id);

    return row && row.archivedAt === null ? row : undefined;
  };

  return createApiFixture<ScenarioApi>({
    tryGetTestSuite: async (input) => {
      const found = world.testSuites.get(input.testSuiteId);

      return found && found.projectId === input.projectId ? found : null;
    },
    listTestSuites: async (input) =>
      [...world.testSuites.values()].filter(
        (one) =>
          one.projectId === input.projectId && (input.includeArchived || one.archivedAt === null),
      ),
    createTestSuite: async (input) => world.addTestSuite({ name: input.name }),
    renameTestSuite: async (input) => {
      const found = world.testSuites.get(input.testSuiteId);
      if (!found) throw new ScenarioTestSuiteNotFoundError(input.testSuiteId);
      const renamed = scenarioTestSuiteSchema.parse({ ...found, name: input.name, updatedAt: NOW });
      world.testSuites.set(renamed.id, renamed);

      return renamed;
    },
    updateTestSuite: async (input) => {
      const found = world.testSuites.get(input.testSuiteId);
      if (!found) throw new ScenarioTestSuiteNotFoundError(input.testSuiteId);
      const updated = scenarioTestSuiteSchema.parse({
        ...found,
        ...(input.name === undefined ? {} : { name: input.name }),
        updatedAt: NOW,
      });
      world.testSuites.set(updated.id, updated);

      return updated;
    },
    archiveTestSuite: async (input) => {
      const found = world.testSuites.get(input.testSuiteId);
      if (!found) throw new ScenarioTestSuiteNotFoundError(input.testSuiteId);
      const archived = scenarioTestSuiteSchema.parse({ ...found, archivedAt: NOW, updatedAt: NOW });
      world.testSuites.set(archived.id, archived);
      for (const scenarioId of archived.scenarioIds) world.archiveScenario(scenarioId, NOW);

      return archived;
    },
    getTestSuiteRunDefinition: async (input) => {
      const found = world.testSuites.get(input.testSuiteId);
      if (!found) throw new ScenarioTestSuiteNotFoundError(input.testSuiteId);

      return {
        testSuite: found,
        scenarioIds: found.scenarioIds.filter((id) => active(id) !== undefined),
      };
    },
    getReferenceStates: async (input) =>
      input.ids.flatMap((id) => {
        const row = world.scenarios.get(id);

        return row ? [{ id: row.id, archivedAt: row.archivedAt }] : [];
      }),
    getNamesByIds: async (input) =>
      input.ids.flatMap((id) => {
        const row = world.scenarios.get(id);

        return row ? [{ id: row.id, name: row.name }] : [];
      }),
    getRunConfigs: async (input): Promise<ScenarioRunConfig[]> =>
      input.ids.flatMap((id) => {
        const row = world.scenarios.get(id);

        return row
          ? [
              {
                id: row.id,
                name: row.name,
                version: row.version,
                situation: row.situation,
                criteria: row.criteria,
                parameters: null,
              },
            ]
          : [];
      }),
    resolveRunParametersForScenarios: async (input) =>
      input.scenarios.map((scenario) => ({
        scenarioId: scenario.id,
        scenarioVersion: scenario.version,
        parameters: {},
        secretParameters: {},
      })),
  });
}

function memoryAgentApi(world: SuiteWorld): AgentApi {
  return createApiFixture<AgentApi>({
    getReferenceStates: async (input) =>
      input.ids.flatMap((id) => {
        const row = world.agents.get(id);

        return row
          ? [{ id: row.id, name: row.name, type: row.type, archivedAt: row.archivedAt }]
          : [];
      }),
    getNamesByIds: async (input) =>
      input.ids.flatMap((id) => {
        const row = world.agents.get(id);

        return row ? [{ id: row.id, name: row.name }] : [];
      }),
  });
}

/** The two Eventing commands a run dispatches, recorded rather than queued. */
class RecordingCommands extends SuiteRunCommandsPort {
  readonly started: StartSuiteRunCommandData[] = [];
  readonly queued: QueueSimulationRunCommandData[] = [];

  async startSuiteRun(data: StartSuiteRunCommandData): Promise<void> {
    this.started.push(data);
  }

  async queueSimulationRun(data: QueueSimulationRunCommandData): Promise<void> {
    this.queued.push(data);
  }
}

class SequentialRunIds extends SuiteRunIdPort {
  private count = 0;

  next(): string {
    this.count += 1;

    return `scenariorun_${this.count}`;
  }
}

export type SuiteFamilies = ReturnType<typeof mountSuiteFamilies>;

/** A handled refusal at its own status, carrying its own code. */
const renderHandled: RestErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    return c.json({ message: error.message, ...error.serialize() }, error.httpStatus as 400);
  }

  return c.json({ code: "internal_server_error", message: String(error) }, 500);
};

/** The code a refusal names, whichever body shape a family publishes. */
export async function errorCodeOf(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { code?: string; error?: string | { code?: string } };
  if (typeof body.code === "string") return body.code;
  if (typeof body.error === "string") return body.error;

  return body.error?.code;
}

/** Who the credential chain resolved the caller as. */
export type RestFamilyCaller = { userId?: string | null | undefined };

const platformUrl = ({ projectSlug, path }: { projectSlug: string; path: string }) =>
  `https://app.langwatch.test/${projectSlug}${path}`;

/** The three families, one application, one world. */
export function mountSuiteFamilies(options: { caller?: RestFamilyCaller | undefined } = {}) {
  const caller = options.caller ?? {};
  const database = MemorySuiteDatabase.create();
  const world = new SuiteWorld(database);
  const commands = new RecordingCommands();
  const scenarios = memoryScenarioApi(world);

  const app = SuiteApp.create({
    repositories: { suites: MemorySuiteRepository.create({ database }) },
    dependencies: {
      scenarios,
      agents: memoryAgentApi(world),
      prompts: createApiFixture<PromptApi>({
        getExistingIds: async () => [],
        getNamesByIds: async () => [],
      }),
      projects: createApiFixture<ProjectApi>({
        tryGetOrganizationId: async () => TEST_PROJECT.organizationId,
      }),
    },
    infrastructure: {
      execution: SuiteExecutionService.create({
        commands,
        ids: new SequentialRunIds(),
        scenarios,
      }),
      resolveClickHouseClient: null,
      defaultRetentionDays: 30,
      generateId: () => world.nextId("suite"),
    },
    config: void 0,
    resources: new ResourceScope(),
  });

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: caller.userId ? { type: "user", id: caller.userId } : null,
        scope: { tier: "project", id: TEST_PROJECT.id },
      }),
    },
  });
  const mount = (onError: RestErrorHandler): RestMountOptions<SuiteApi> => ({
    app: () => app,
    credential: "projectKey",
    onError,
    facts: [
      bindRestMiddleware(projectRestFacts, () => ({
        projectSlug: TEST_PROJECT.slug,
        viewerUserId: caller.userId ?? null,
        actorId: caller.userId ?? "project-key-1",
      })),
      bindRestHeader(suiteSurfaceFact, "x-langwatch-surface"),
    ],
  });

  // The three families register absolute paths, so the first one's app serves
  // as the root the other two are routed into.
  const hono = runtime.mount(createRunPlansRest(platformUrl).router(), mount(renderHandled));
  hono.route("/", runtime.mount(createTestSuitesRest(platformUrl).router(), mount(renderHandled)));
  hono.route(
    "/",
    runtime.mount(
      createSuitesAliasRest(platformUrl).router(),
      mount(suitesAliasErrorHandler(renderHandled)),
    ),
  );

  const send = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    hono.fetch(
      new Request(`http://api.test${path}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  const api = {
    get: (path: string, headers?: Record<string, string>) => send("GET", path, undefined, headers),
    post: (path: string, body?: unknown, headers?: Record<string, string>) =>
      send("POST", path, body ?? {}, headers),
    patch: (path: string, body?: unknown, headers?: Record<string, string>) =>
      send("PATCH", path, body ?? {}, headers),
    delete: (path: string, headers?: Record<string, string>) =>
      send("DELETE", path, undefined, headers),
  };

  return { api, world, commands, app };
}
