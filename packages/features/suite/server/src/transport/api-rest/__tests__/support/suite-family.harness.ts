/**
 * The three suite REST families over the REAL suite application.
 *
 * `/api/v1/run-plans`, `/api/v1/test-suites` and the deprecated `/api/suites`
 * alias all answer from ONE `SuiteApp`, which is why they are stood up
 * together: what a suite about them is really asking is whether two doors onto
 * one plan can disagree, and mounting one family at a time could not tell.
 *
 * Below the transport, everything that decides an answer is the product's own
 * code — `SuiteApp`, `SuiteService`, `SuiteExecutionService`. Only the
 * repositories are stood up here, in memory, with the semantics the Postgres
 * ones carry: a plan is matched by name, trimmed and without case; a slug is
 * derived once and kept across a rename; an archived row leaves the list. A
 * fake of `SuiteApp` would have made the "created" flag, the name resolution
 * and the test-suite/run-plan disjointness assertions about the fake.
 *
 * The event stack is a RECORDER rather than a queue: a run's real consequence
 * is the two commands it dispatches, and the suites read them back.
 */
import type { AgentService } from "@langwatch/agent-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import type { ProjectService } from "@langwatch/project-contract";
import {
  scenarioTestSuiteSchema,
  type ScenarioRunConfig,
  type ScenarioService,
  type ScenarioTestSuite,
  type SimulationService,
} from "@langwatch/scenario-contract";
import {
  ScenarioTestSuiteNotFoundError,
  SuiteNameTakenError,
  SuiteNotFoundError,
  suiteSchema,
  type CreateSuiteCommand,
  type RunPlanConfigInput,
  type StartSuiteRunCommandData,
  type Suite,
  type SuiteIdInput,
  type SuiteScope,
  type UpdateSuiteCommand,
} from "@langwatch/suite-contract";
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import type { ErrorHandler, MiddlewareHandler } from "hono";

import { SuiteApp } from "../../../../app/suite.app";
import {
  SuiteRunCommandsPort,
  SuiteRunIdPort,
  type QueueSimulationRunCommandData,
} from "../../../../ports/suite-execution.port";
import { SuiteRepository } from "../../../../repositories/suite.repository";
import { SuiteExecutionService } from "../../../../services/suite-execution.service";
import { SuiteService } from "../../../../services/suite.service";
import { createRunPlansV1RestApp } from "../../run-plans-v1.api";
import { createSuiteRestApp } from "../../suite.api";
import { createTestSuitesV1RestApp } from "../../test-suites-v1.api";

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

type AgentRow = { id: string; name: string; type: string; archivedAt: Date | null };

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
  for (let index = 2; ; index++) {
    const candidate = `${base}-${index}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

const planNameKey = (name: string) => name.trim().toLowerCase();

/** The rows all three families read, with the ids a suite seeds by. */
export class SuiteWorld {
  readonly scenarios = new Map<string, ScenarioRow>();
  readonly testSuites = new Map<string, ScenarioTestSuite>();
  readonly agents = new Map<string, AgentRow>();
  readonly plans = new Map<string, Suite>();
  private sequence = 0;

  nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${this.sequence}`;
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
    return row;
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
      slug: nextAvailableSlug(slugify(name), [...this.testSuites.values()].map((one) => one.slug)),
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
      if (scenario) scenario.testSuiteId = id;
    }
    return testSuite;
  }

  /** A test suite with `count` scenarios filed into it. */
  addTestSuiteWithCases(name: string, count: number): { testSuite: ScenarioTestSuite; cases: ScenarioRow[] } {
    const cases = Array.from({ length: count }, (_, index) =>
      this.addScenario({ name: `${name} scenario ${index}` }),
    );
    return { testSuite: this.addTestSuite({ name, scenarioIds: cases.map((one) => one.id) }), cases };
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
        nextAvailableSlug(slugify(name), [...this.plans.values()].map((one) => one.slug)),
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

/** The run-plan rows, with the Postgres repository's own name and slug rules. */
class MemorySuiteRepository extends SuiteRepository {
  constructor(private readonly world: SuiteWorld) {
    super();
  }

  async create(input: CreateSuiteCommand & { id: string; slug: string }): Promise<Suite> {
    const plan = suiteSchema.parse({
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      slug: input.slug,
      kind: "run_plan",
      description: input.description ?? null,
      scenarioIds: input.scenarioIds ?? [],
      scope: input.scope ?? null,
      targets: input.targets ?? [],
      repeatCount: input.repeatCount ?? 1,
      labels: input.labels ?? [],
      simulatorModel: input.simulatorModel ?? null,
      judgeModel: input.judgeModel ?? null,
      archivedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    this.world.plans.set(plan.id, plan);
    return plan;
  }

  async list(input: { projectId: string; includeArchived?: boolean }): Promise<Suite[]> {
    return [...this.world.plans.values()].filter(
      (plan) =>
        plan.projectId === input.projectId && (input.includeArchived || plan.archivedAt === null),
    );
  }

  async resolveDynamicRunMembership(input: SuiteIdInput): Promise<string[]> {
    const plan = this.world.plans.get(input.id);
    return plan?.scenarioIds ?? [];
  }

  async resolveScopeMembership(input: { projectId: string; scope: SuiteScope }): Promise<string[]> {
    const active = [...this.world.scenarios.values()].filter((one) => one.archivedAt === null);
    if (input.scope.mode === "all") return active.map((one) => one.id);
    if (input.scope.mode === "test_suites") {
      const named = new Set(input.scope.testSuiteIds);
      return active.filter((one) => one.testSuiteId && named.has(one.testSuiteId)).map((one) => one.id);
    }
    return [];
  }

  async tryFindById(input: SuiteIdInput): Promise<Suite | null> {
    const plan = this.world.plans.get(input.id);
    return plan && plan.projectId === input.projectId ? plan : null;
  }

  async tryFindBySlug(input: { projectId: string; slug: string }): Promise<Suite | null> {
    return (
      [...this.world.plans.values()].find(
        (plan) => plan.projectId === input.projectId && plan.slug === input.slug,
      ) ?? null
    );
  }

  async saveManagedRunAll(input: {
    id: string;
    projectId: string;
    name: string;
    baseSlug: string;
    label: string;
    scenarioIds: string[];
    targets?: Suite["targets"];
  }): Promise<Suite> {
    return this.create({
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      slug: input.baseSlug,
      scenarioIds: input.scenarioIds,
      targets: input.targets ?? [],
      labels: [input.label],
    } as CreateSuiteCommand & { id: string; slug: string });
  }

  async findOrCreatePlanByName(input: {
    id: string;
    projectId: string;
    name: string;
    scope: SuiteScope;
    targets: Suite["targets"];
    scenarioIds: string[];
    config: RunPlanConfigInput;
  }): Promise<{ suite: Suite; created: boolean }> {
    const stored = {
      scope: input.scope,
      targets: input.targets,
      scenarioIds: input.scenarioIds,
      repeatCount: input.config.repeatCount ?? 1,
      simulatorModel: input.config.simulatorModel ?? null,
      judgeModel: input.config.judgeModel ?? null,
    };

    const existing = [...this.world.plans.values()].find(
      (plan) =>
        plan.projectId === input.projectId &&
        plan.kind === "run_plan" &&
        plan.archivedAt === null &&
        planNameKey(plan.name) === planNameKey(input.name),
    );
    if (existing) {
      const updated = suiteSchema.parse({ ...existing, ...stored, updatedAt: NOW });
      this.world.plans.set(updated.id, updated);
      return { suite: updated, created: false };
    }

    const slug = nextAvailableSlug(
      slugify(input.name),
      [...this.world.plans.values()]
        .filter((plan) => plan.archivedAt === null)
        .map((plan) => plan.slug),
    );
    const created = suiteSchema.parse({
      id: input.id,
      projectId: input.projectId,
      name: input.name.trim(),
      slug,
      kind: "run_plan",
      description: null,
      labels: [],
      archivedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      ...stored,
    });
    this.world.plans.set(created.id, created);
    return { suite: created, created: true };
  }

  async update(input: UpdateSuiteCommand & { slug?: string }): Promise<Suite> {
    const existing = this.world.plans.get(input.id);
    if (!existing || existing.projectId !== input.projectId) {
      throw new SuiteNotFoundError(input.id);
    }
    const named = [...this.world.plans.values()].find(
      (plan) =>
        plan.id !== input.id &&
        plan.projectId === input.projectId &&
        input.name !== undefined &&
        planNameKey(plan.name) === planNameKey(input.name),
    );
    if (named) throw new SuiteNameTakenError(input.name ?? "");

    const updated = suiteSchema.parse({
      ...existing,
      ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
      id: existing.id,
      projectId: existing.projectId,
      slug: input.slug ?? existing.slug,
      updatedAt: NOW,
    });
    this.world.plans.set(updated.id, updated);
    return updated;
  }

  async archive(input: SuiteIdInput & { archivedAt: Date; archivedSlug: string }): Promise<Suite> {
    const existing = this.world.plans.get(input.id);
    if (!existing || existing.projectId !== input.projectId) {
      throw new SuiteNotFoundError(input.id);
    }
    const archived = suiteSchema.parse({
      ...existing,
      archivedAt: input.archivedAt,
      slug: input.archivedSlug,
      updatedAt: NOW,
    });
    this.world.plans.set(archived.id, archived);
    return archived;
  }
}

/**
 * The scenario half of the world.
 *
 * Only the operations the three families reach are implemented; every other
 * one is a NAMED absence, so a scenario that wandered into one fails saying so
 * rather than reading an empty answer.
 */
function memoryScenarioService(world: SuiteWorld): ScenarioService {
  const active = (id: string) => {
    const row = world.scenarios.get(id);
    return row && row.archivedAt === null ? row : undefined;
  };

  const implemented = {
    list: async () => [...world.scenarios.values()].filter((one) => one.archivedAt === null),
    tryGetTestSuite: async (input: { testSuiteId: string; projectId: string }) => {
      const found = world.testSuites.get(input.testSuiteId);
      return found && found.projectId === input.projectId ? found : null;
    },
    listTestSuites: async (input: { projectId: string; includeArchived?: boolean }) =>
      [...world.testSuites.values()].filter(
        (one) =>
          one.projectId === input.projectId &&
          (input.includeArchived || one.archivedAt === null),
      ),
    createTestSuite: async (input: { projectId: string; name: string }) =>
      world.addTestSuite({ name: input.name }),
    renameTestSuite: async (input: { testSuiteId: string; projectId: string; name: string }) => {
      const found = world.testSuites.get(input.testSuiteId);
      if (!found) throw new ScenarioTestSuiteNotFoundError(input.testSuiteId);
      const renamed = scenarioTestSuiteSchema.parse({ ...found, name: input.name, updatedAt: NOW });
      world.testSuites.set(renamed.id, renamed);
      return renamed;
    },
    updateTestSuite: async (input: { testSuiteId: string; name?: string }) => {
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
    archiveTestSuite: async (input: { testSuiteId: string }) => {
      const found = world.testSuites.get(input.testSuiteId);
      if (!found) throw new ScenarioTestSuiteNotFoundError(input.testSuiteId);
      const archived = scenarioTestSuiteSchema.parse({ ...found, archivedAt: NOW, updatedAt: NOW });
      world.testSuites.set(archived.id, archived);
      for (const scenarioId of archived.scenarioIds) {
        const scenario = world.scenarios.get(scenarioId);
        if (scenario) scenario.archivedAt = NOW;
      }
      return archived;
    },
    getTestSuiteRunDefinition: async (input: { testSuiteId: string }) => {
      const found = world.testSuites.get(input.testSuiteId);
      if (!found) throw new ScenarioTestSuiteNotFoundError(input.testSuiteId);
      return { scenarioIds: found.scenarioIds.filter((id) => active(id) !== undefined) };
    },
    getReferenceStates: async (input: { ids: string[] }) =>
      input.ids.flatMap((id) => {
        const row = world.scenarios.get(id);
        return row ? [{ id: row.id, archivedAt: row.archivedAt }] : [];
      }),
    getNamesByIds: async (input: { ids: string[] }) =>
      input.ids.flatMap((id) => {
        const row = world.scenarios.get(id);
        return row ? [{ id: row.id, name: row.name }] : [];
      }),
    getRunConfigs: async (input: { ids: string[] }): Promise<ScenarioRunConfig[]> =>
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
    resolveRunParametersForScenarios: async (input: { scenarios: ScenarioRunConfig[] }) =>
      input.scenarios.map((scenario) => ({
        scenarioId: scenario.id,
        parameters: {},
        secretParameters: {},
      })),
  };

  return namedAbsences(implemented, "scenario");
}

function memoryAgentService(world: SuiteWorld): AgentService {
  return namedAbsences(
    {
      getReferenceStates: async (input: { ids: string[] }) =>
        input.ids.flatMap((id) => {
          const row = world.agents.get(id);
          return row
            ? [{ id: row.id, name: row.name, type: row.type, archivedAt: row.archivedAt }]
            : [];
        }),
      getNamesByIds: async (input: { ids: string[] }) =>
        input.ids.flatMap((id) => {
          const row = world.agents.get(id);
          return row ? [{ id: row.id, name: row.name }] : [];
        }),
      tryGetByReference: async () => null,
      findNamesByIds: async () => [],
    },
    "agent",
  );
}

function memoryPromptService(): PromptService {
  return namedAbsences(
    { getExistingIds: async () => [], getNamesByIds: async () => [] },
    "prompt",
  );
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

/**
 * A handled refusal at its own status, carrying its own code.
 *
 * The process's own rendering is `ApiRestObservabilityComposition`, pinned by
 * its own suites; what these suites assert is the code and the status the
 * family raises, which is what a customer acts on either way.
 */
const renderHandled: ErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    return c.json(
      { code: error.code, message: error.message, ...error.serialize() },
      error.httpStatus as 400,
    );
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

/**
 * Every caller authenticated as one project.
 *
 * `userId: null` is the distinct case of a key naming no person, which is what
 * decides whether a run records an actor.
 */
function suiteTestSecurity(caller: RestFamilyCaller): AppRestSecurity {
  const pass: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  const asProject: MiddlewareHandler = async (c, next) => {
    c.set("project", TEST_PROJECT);
    if (caller.userId !== null && caller.userId !== undefined) c.set("apiKeyUserId", caller.userId);
    await next();
  };

  const ports: RestApiServicePorts = {
    appContext: pass,
    requestLogger: () => pass,
    requestTracer: () => pass,
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
    authenticateProject: () => asProject,
    authorizeProjectPermission: () => pass,
    authorizeApiKeyCeiling: () => pass,
    authenticateOrganization: () => pass,
    authorizeOrganizationPermission: () => pass,
    authorizeRouteTeamPermission: () => pass,
    authorizeRouteProjectPermission: () => pass,
    authenticateOrganizationThrowing: pass,
    authorizeOrganizationPermissionThrowing: () => pass,
  };
  return createAppRestSecurity(ports);
}

/** Who the credential chain resolved the caller as. */
export type RestFamilyCaller = { userId?: string | null | undefined };

/**
 * The three families, one application, one world.
 *
 * `caller` is passed straight through to the shared harness, so a suite about
 * the actor a run records says who the credential belongs to rather than
 * describing the credential chain again.
 */
export function mountSuiteFamilies(options: { caller?: RestFamilyCaller | undefined } = {}) {
  const world = new SuiteWorld();
  const commands = new RecordingCommands();
  const scenarios = memoryScenarioService(world);

  const suites = SuiteService.create({
    repository: new MemorySuiteRepository(world),
    scenarios,
    agents: memoryAgentService(world),
    prompts: memoryPromptService(),
    execution: SuiteExecutionService.create({
      commands,
      ids: new SequentialRunIds(),
      scenarios,
    }),
    runRepository: namedAbsences({}, "suite run projection"),
    generateId: () => world.nextId("suite"),
    now: () => NOW,
  });

  const app = SuiteApp.create({
    suites,
    scenarios,
    projects: namedAbsences(
      {
        tryGetWithTeam: async () => ({
          id: TEST_PROJECT.id,
          team: { organizationId: TEST_PROJECT.organizationId },
        }),
      },
      "project",
    ) as ProjectService,
    simulations: namedAbsences(
      { getInternalSuiteSummaries: async () => [] },
      "simulation",
    ) as SimulationService,
  });

  const security = suiteTestSecurity(options.caller ?? {});
  const platformUrl = ({ projectSlug, path }: { projectSlug: string; path: string }) =>
    `https://app.langwatch.test/${projectSlug}${path}`;
  // The three families register absolute paths, so the first one's router
  // serves as the root the other two are routed into.
  const hono = createRunPlansV1RestApp({ security, suites: () => app, platformUrl }).hono;
  hono.route("/", createTestSuitesV1RestApp({ security, suites: () => app, platformUrl }).hono);
  hono.route("/", createSuiteRestApp({ security, suites: () => app, platformUrl }).hono);

  const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
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
    routes: () => hono.routes.map((route) => route.path),
  };

  return { api, world, commands, app };
}

/**
 * The given operations, with everything else refusing by name.
 *
 * A stub that answered emptily would let a scenario pass over a collaborator
 * this harness never composed.
 */
function namedAbsences<T extends object>(implemented: T, subject: string): never {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (value !== undefined) return value;
      return () => {
        throw new Error(`This harness composes no ${subject} ${String(property)}`);
      };
    },
  }) as never;
}
