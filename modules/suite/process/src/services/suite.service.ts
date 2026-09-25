import type { AgentApi } from "@langwatch/agent-contract";
import type { EvaluatorApi, EvaluatorWithFields } from "@langwatch/evaluator-contract";
import { ValidationError } from "@langwatch/handled-error";
import type { PromptApi } from "@langwatch/prompt-contract";
import {
  jsonValueSchema,
  ScenarioTestSuiteNotFoundError,
  type EvaluatorAttachment,
  type ScenarioTestSuite,
  type ScenarioApi,
} from "@langwatch/scenario-contract";
import {
  createSuiteCommandSchema,
  mergeRunAttachments,
  readEvaluatorAttachments,
  suiteArchivedNamesInputSchema,
  suiteIdInputSchema,
  suiteSchema,
  SuiteTestSuiteMembershipManagedError,
  SuiteNameTakenError,
  SuiteNotFoundError,
  SuiteScopeNotAllowedError,
  updateSuiteCommandSchema,
  type CreateSuiteCommand,
  type Suite,
  type SuiteArchivedNamesInput,
  type SuiteIdInput,
  type SuiteRunAllInput,
  type SuiteRunAllResult,
  type SuiteRunInput,
  type SuiteRunResult,
  type SuiteRunPlanInput,
  type SuiteRunPlanResult,
  type UpdateSuiteCommand,
} from "@langwatch/suite-contract";
import { nowInstant, toDate, type Instant } from "@langwatch/time";

import type { SuiteExecution } from "../app/suite.app.ts";
import type { SuiteRepository } from "../repositories/suite.repository.ts";
import { defaultSuiteId, isAgentTarget, suiteSlugOf } from "../rules/suite-target.rules.ts";
import type { ConnectedPresenceReader } from "./connected-target.service.ts";
import { SuiteRunService } from "./suite-run.service.ts";

const archivedSlugSuffix = "--archived";

const PLAN_FIELDS_REFUSAL = "A run plan takes no fields. Fields are declared on a test suite.";

export type SuiteServiceOptions = {
  repository: SuiteRepository;
  scenarios: ScenarioApi;
  agents: AgentApi;
  prompts: PromptApi;
  evaluators: EvaluatorApi;
  execution: SuiteExecution;
  /**
   * Which connected agents have a process attached, so a target naming an
   * agent without environment can be settled. Absent on a process with no
   * connected-agent runtime: every agent reads offline, refusing rather than guessing.
   */
  connectedPresence?: ConnectedPresenceReader;
  generateId?: () => string;
  now?: () => Instant;
};

export class SuiteService {
  static create(options: SuiteServiceOptions): SuiteService {
    return new SuiteService(options);
  }

  private readonly runs: SuiteRunService;

  private constructor(private readonly options: SuiteServiceOptions) {
    this.runs = SuiteRunService.create({
      options,
      get: (input) => this.get(input),
      readPlanEvaluators: (input) => this.readPlanEvaluators(input),
      testSuiteToSuite: (testSuite) => SuiteService.testSuiteToSuite(testSuite),
    });
  }

  list(input: { projectId: string; includeArchived?: boolean }): Promise<Suite[]> {
    return this.options.repository.findAll(input);
  }

  async get(input: SuiteIdInput): Promise<Suite> {
    const suite = await this.findById(input);
    if (!suite) {
      throw new SuiteNotFoundError(input.id);
    }

    return suite;
  }

  async findById(input: SuiteIdInput): Promise<Suite | null> {
    const parsed = suiteIdInputSchema.parse(input);
    const suite = await this.options.repository.findById(parsed);
    if (suite) {
      return suite;
    }

    const testSuite = await this.options.scenarios.findTestSuite({
      testSuiteId: parsed.id,
      projectId: parsed.projectId,
    });

    return testSuite ? SuiteService.testSuiteToSuite(testSuite) : null;
  }

  async create(input: CreateSuiteCommand): Promise<Suite> {
    const parsed = createSuiteCommandSchema.parse(input);
    const slug = suiteSlugOf(parsed.name);
    await this.assertSlugAvailable({ projectId: parsed.projectId, slug });

    return this.options.repository.create({
      ...parsed,
      id: (this.options.generateId ?? defaultSuiteId)(),
      slug,
    });
  }

  async update(input: UpdateSuiteCommand): Promise<Suite> {
    const parsed = updateSuiteCommandSchema.parse(input);
    const existing = await this.get({ id: parsed.id, projectId: parsed.projectId });
    if (existing.kind === "test_suite") {
      if (parsed.scope !== void 0) {
        throw new SuiteScopeNotAllowedError();
      }

      if (parsed.scenarioIds !== void 0) {
        throw new SuiteTestSuiteMembershipManagedError();
      }

      return this.updateTestSuite(parsed);
    }

    const { fields, evaluators, ...columns } = parsed;
    if (fields !== undefined) {
      throw new ValidationError(PLAN_FIELDS_REFUSAL, {
        meta: { fieldErrors: { fields: [PLAN_FIELDS_REFUSAL] } },
      });
    }

    const slug = columns.name === undefined ? undefined : suiteSlugOf(columns.name);
    if (slug !== undefined) {
      await this.assertSlugAvailable({
        projectId: columns.projectId,
        slug,
        excludeId: columns.id,
      });
    }

    const checked =
      evaluators === undefined
        ? undefined
        : await this.readPlanEvaluators({ projectId: columns.projectId, attachments: evaluators });

    return this.options.repository.update({
      ...columns,
      ...(slug === undefined ? {} : { slug }),
      ...(checked === undefined ? {} : { evaluators: checked }),
    });
  }

  /**
   * The attachments one run carries: the test suite's, then the plan's own, each evaluator
   * once. An archived row still answers, so a run reads what it was queued with.
   */
  async getRunAttachments(input: {
    projectId: string;
    suiteId?: string | null;
    planId?: string | null;
  }): Promise<EvaluatorAttachment[]> {
    const { projectId, suiteId, planId } = input;
    const [testSuites, planAttachments] = await Promise.all([
      suiteId
        ? this.options.scenarios.listTestSuites({ projectId, includeArchived: true })
        : Promise.resolve([]),
      planId
        ? this.options.repository.findPlanEvaluators({ projectId, id: planId })
        : Promise.resolve([]),
    ]);
    const testSuite = testSuites.find((candidate) => candidate.id === suiteId);
    return mergeRunAttachments({
      suiteAttachments: testSuite?.evaluators ?? [],
      planAttachments,
    });
  }

  /** The saved evaluators the attachments name, with their fields, by id; unknown ids left out. */
  async getAttachedEvaluators(input: {
    projectId: string;
    attachments: readonly Pick<EvaluatorAttachment, "evaluatorId">[];
  }): Promise<Map<string, EvaluatorWithFields>> {
    const ids = [...new Set(input.attachments.map((attachment) => attachment.evaluatorId))];
    const rows = await Promise.all(
      ids.map((id) =>
        this.options.evaluators.findByIdWithFields({ id, projectId: input.projectId }),
      ),
    );
    return new Map(rows.flatMap((row) => (row ? [[row.id, row] as const] : [])));
  }

  /**
   * A run plan's own evaluators, checked against the project: each must name
   * a saved evaluator, and none may read a scenario field.
   */
  async readPlanEvaluators(input: {
    projectId: string;
    attachments: EvaluatorAttachment[];
  }): Promise<EvaluatorAttachment[]> {
    const saved = await this.options.evaluators.getAllWithFields({ projectId: input.projectId });
    return readEvaluatorAttachments({
      attachments: input.attachments,
      fields: [],
      isPlanLevel: true,
      evaluatorsById: new Map(saved.map((evaluator) => [evaluator.id, evaluator])),
    });
  }

  async duplicate(input: SuiteIdInput): Promise<Suite> {
    const source = await this.get(input);
    const name = `${source.name} (copy)`;
    const slug = suiteSlugOf(name);
    await this.assertSlugAvailable({ projectId: source.projectId, slug });

    return this.options.repository.create({
      projectId: source.projectId,
      name,
      description: source.description,
      scenarioIds: source.scenarioIds,
      ...(source.scope ? { scope: source.scope } : {}),
      targets: source.targets,
      repeatCount: source.repeatCount,
      labels: source.labels,
      simulatorModel: source.simulatorModel,
      judgeModel: source.judgeModel,
      id: (this.options.generateId ?? defaultSuiteId)(),
      slug,
    });
  }

  async archive(input: SuiteIdInput): Promise<Suite> {
    const suite = await this.get(input);
    if (suite.kind === "test_suite") {
      return this.archiveTestSuite(suite);
    }

    const archivedSlug = suite.slug.endsWith(archivedSlugSuffix)
      ? suite.slug
      : `${suite.slug}${archivedSlugSuffix}-${suite.id.slice(-6)}`;

    return this.options.repository.archive({
      ...input,
      archivedAt: toDate((this.options.now ?? nowInstant)()),
      archivedSlug,
    });
  }

  async run(input: SuiteRunInput): Promise<SuiteRunResult> {
    return this.runs.run(input);
  }

  async runPlan(input: SuiteRunPlanInput): Promise<SuiteRunPlanResult> {
    return this.runs.runPlan(input);
  }

  async runAll(input: SuiteRunAllInput): Promise<SuiteRunAllResult> {
    return this.runs.runAll(input);
  }

  async resolveArchivedNames(input: SuiteArchivedNamesInput): Promise<{
    scenarios: Record<string, string>;
    targets: Record<string, string>;
  }> {
    const parsed = suiteArchivedNamesInputSchema.parse(input);
    const { scenarios, agents, prompts } = this.options;
    const scenarioRows =
      parsed.scenarioIds.length === 0
        ? []
        : await scenarios.getNamesByIds({
            ids: parsed.scenarioIds,
            projectId: parsed.projectId,
          });
    const agentIds = parsed.targets
      .filter((target) => isAgentTarget(target))
      .map((target) => target.referenceId);
    const promptIds = parsed.targets
      .filter((target) => target.type === "prompt")
      .map((target) => target.referenceId);
    const [agentRows, promptRows] = await Promise.all([
      agentIds.length === 0
        ? []
        : agents.getNamesByIds({ ids: agentIds, projectId: parsed.projectId }),
      promptIds.length === 0
        ? []
        : prompts.getNamesByIds({
            ids: promptIds,
            projectId: parsed.projectId,
            organizationId: parsed.organizationId,
          }),
    ]);

    return {
      scenarios: Object.fromEntries(scenarioRows.map((row) => [row.id, row.name])),
      targets: Object.fromEntries([...agentRows, ...promptRows].map((row) => [row.id, row.name])),
    };
  }

  private async updateTestSuite(input: UpdateSuiteCommand): Promise<Suite> {
    try {
      const testSuite = await this.options.scenarios.updateTestSuite({
        testSuiteId: input.id,
        projectId: input.projectId,
        name: input.name,
        description: input.description,
        targets: input.targets?.map((target) => jsonValueSchema.parse(target)),
        repeatCount: input.repeatCount,
        labels: input.labels,
        simulatorModel: input.simulatorModel,
        judgeModel: input.judgeModel,
        fields: input.fields,
        evaluators: input.evaluators,
      });

      return SuiteService.testSuiteToSuite(testSuite);
    } catch (error) {
      if (error instanceof ScenarioTestSuiteNotFoundError) {
        throw new SuiteNotFoundError(input.id);
      }

      throw error;
    }
  }

  private async archiveTestSuite(suite: Suite): Promise<Suite> {
    try {
      const testSuite = await this.options.scenarios.archiveTestSuite({
        testSuiteId: suite.id,
        projectId: suite.projectId,
      });

      return SuiteService.testSuiteToSuite(testSuite);
    } catch (error) {
      if (error instanceof ScenarioTestSuiteNotFoundError) {
        throw new SuiteNotFoundError(suite.id);
      }

      throw error;
    }
  }

  private async assertSlugAvailable(input: {
    projectId: string;
    slug: string;
    excludeId?: string;
  }): Promise<void> {
    const existing = await this.options.repository.findBySlug(input);
    if (existing && existing.id !== input.excludeId) {
      throw new SuiteNameTakenError(existing.name);
    }
  }

  private static testSuiteToSuite(testSuite: ScenarioTestSuite): Suite {
    // Drop test-suite-only fields before strict parsing; passing the whole row caused
    // `unrecognized_keys` across reads (apidiff run 20260916-r8).
    const { fields: _fields, evaluators: _evaluators, ...suite } = testSuite;

    return suiteSchema.parse(suite);
  }
}
