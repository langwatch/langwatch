import type { DatasetApi, DatasetSummary } from "@langwatch/dataset-contract";
import {
  evaluatorConfigSchema,
  newEvaluatorId,
  type Evaluator,
  type EvaluatorApi,
} from "@langwatch/evaluator-contract";
import { generate } from "@langwatch/ksuid";
import {
  monitorCreateInputSchema,
  type MonitorApi,
  type MonitorWithEvaluator,
} from "@langwatch/monitor-contract";
import type {
  OrganizationApi,
  OrganizationProvisioningSummary,
} from "@langwatch/organization-contract";
import type { Project, ProjectApi } from "@langwatch/project-contract";
import type { PromptApi, VersionedPrompt } from "@langwatch/prompt-contract";
import type { StaffAccessCopyItem, StaffAccessCopyKind } from "@langwatch/staff-access-contract";
import type { Instant } from "@langwatch/time";

import type { StaffAccessCopyLedgerRepository } from "../repositories/staff-access.repository.ts";
import {
  copyItem,
  failureReason,
  promptFields,
  selectProjects,
} from "../rules/staff-access-copy.rules.ts";

const PAGE = 100;
const DATASET_PAGE = 1000;
/** A bound on paging; no organization or project comes near it. */
const MAX_PAGES = 1000;

type RunDeps = Readonly<{
  ledger: StaffAccessCopyLedgerRepository;
  organizations: Pick<OrganizationApi, "listTeams">;
  projects: Pick<ProjectApi, "listByOrganization" | "findById" | "createInOrganization">;
  evaluators: Pick<EvaluatorApi, "getAll" | "create">;
  monitors: Pick<MonitorApi, "list" | "create" | "toggle">;
  prompts: Pick<PromptApi, "getAllPrompts" | "getAllVersions" | "createPrompt" | "updatePrompt">;
  datasets: Pick<DatasetApi, "findDatasetSummaries" | "copyDataset">;
  now: () => Instant;
}>;

/** One source object the plan found, with what it carries to be copied. */
type Work =
  | { kind: "project"; source: Project }
  | { kind: "evaluator"; source: Evaluator }
  | { kind: "monitor"; source: MonitorWithEvaluator }
  | { kind: "prompt"; source: VersionedPrompt }
  | { kind: "dataset"; source: DatasetSummary };

type Step = Readonly<{ item: StaffAccessCopyItem; work: Work | null }>;
type Placed = Readonly<{ targetId: string; targetProjectId: string }>;
type Organization = OrganizationProvisioningSummary;
type Teams = { teamId: string | undefined; looked: boolean };
/** What one execution carries from step to step. */
type Run = {
  requestId: string;
  source: Organization;
  target: Organization;
  placed: Map<string, Placed>;
  teams: Teams;
};

export type StaffAccessCopyPlan = Readonly<{
  items: StaffAccessCopyItem[];
  steps: readonly Step[];
  /** `${kind}:${sourceId}` -> where an earlier copy put it. */
  placed: ReadonlyMap<string, Placed>;
}>;

const keyOf = (kind: StaffAccessCopyKind, sourceId: string) => `${kind}:${sourceId}`;

/**
 * Reads what a copy would make and makes it, through each owner's `*Api` only. The allowlist is
 * the kinds below; anything else in the organization is never read. A rerun skips every object
 * the ledger says an earlier copy made, so it adds only what is new.
 */
export class StaffAccessCopyRunService {
  private constructor(private readonly deps: RunDeps) {}

  static create(deps: RunDeps): StaffAccessCopyRunService {
    return new StaffAccessCopyRunService(deps);
  }

  async plan({
    source,
    target,
    projects: named,
  }: {
    source: Organization;
    target: Organization;
    projects: readonly string[] | undefined;
  }): Promise<StaffAccessCopyPlan> {
    const ledger = await this.deps.ledger.findForPair({
      sourceOrganizationId: source.id,
      targetOrganizationId: target.id,
    });
    const placed = new Map<string, Placed>(
      ledger.map((row) => [
        keyOf(row.kind as StaffAccessCopyKind, row.sourceId),
        { targetId: row.targetId, targetProjectId: row.targetProjectId },
      ]),
    );
    const { selected, unknown } = selectProjects({
      projects: await this.copyableProjects({ organizationId: source.id }),
      named,
    });

    const steps: Step[] = unknown.map((name) => ({
      item: copyItem({ kind: "project", name, sourceId: name, sourceProjectId: name }, "skipped", {
        reason: "project_not_found",
      }),
      work: null,
    }));
    for (const project of selected) {
      steps.push(...(await this.planProject({ project, source, placed })));
    }
    return { items: steps.map((step) => step.item), steps, placed };
  }

  /** Makes every planned item in order, each on its own: one failure never stops the rest. */
  async execute({
    plan,
    requestId,
    source,
    target,
  }: {
    plan: StaffAccessCopyPlan;
    requestId: string;
    source: Organization;
    target: Organization;
  }): Promise<StaffAccessCopyItem[]> {
    const run: Run = {
      requestId,
      source,
      target,
      placed: new Map(plan.placed),
      teams: { teamId: undefined, looked: false },
    };
    const results: StaffAccessCopyItem[] = [];
    for (const step of plan.steps) results.push(await this.runStep({ step, run }));
    return results;
  }

  private async runStep({ step, run }: { step: Step; run: Run }): Promise<StaffAccessCopyItem> {
    if (step.item.outcome !== "planned" || !step.work) return step.item;
    const targetProjectId =
      step.work.kind === "project"
        ? null
        : run.placed.get(keyOf("project", step.item.sourceProjectId))?.targetProjectId;
    if (targetProjectId === undefined) {
      return { ...step.item, outcome: "skipped", reason: "project_not_copied" };
    }
    try {
      const made = await this.make({
        work: step.work,
        sourceProjectId: step.item.sourceProjectId,
        targetProjectId,
        run,
      });
      if ("skipped" in made) return { ...step.item, outcome: "skipped", reason: made.skipped };
      const recorded = await this.deps.ledger.record({
        id: generate("staffcopy").toString(),
        requestId: run.requestId,
        sourceOrganizationId: run.source.id,
        targetOrganizationId: run.target.id,
        kind: step.item.kind,
        sourceId: step.item.sourceId,
        targetId: made.targetId,
        sourceProjectId: step.item.sourceProjectId,
        targetProjectId: made.targetProjectId,
        createdAt: this.deps.now(),
      });
      run.placed.set(keyOf(step.item.kind, step.item.sourceId), made);
      return {
        ...step.item,
        outcome: recorded ? "copied" : "failed",
        targetId: made.targetId,
        targetProjectId: made.targetProjectId,
        reason: recorded ? null : "copied_by_a_concurrent_run",
      };
    } catch (error) {
      return { ...step.item, outcome: "failed", reason: failureReason(error) };
    }
  }

  private async copyableProjects({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<Project[]> {
    const projects: Project[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const answer = await this.deps.projects.listByOrganization({
        organizationId,
        page,
        limit: PAGE,
      });
      projects.push(...answer.data);
      if (answer.data.length < PAGE) break;
    }
    return projects.filter(
      (project) =>
        project.kind === "application" && !project.isPersonal && project.archivedAt === null,
    );
  }

  /** The project and everything allowlisted in it, in the order a copy makes them. */
  private async planProject({
    project,
    source,
    placed,
  }: {
    project: Project;
    source: Organization;
    placed: ReadonlyMap<string, Placed>;
  }): Promise<Step[]> {
    const at = { sourceProjectId: project.id };
    const earlier = placed.get(keyOf("project", project.id));
    const projectStep: Step = {
      item: earlier
        ? copyItem(
            { kind: "project", name: project.name, sourceId: project.id, ...at },
            "already_copied",
            earlier,
          )
        : copyItem({ kind: "project", name: project.name, sourceId: project.id, ...at }, "planned"),
      work: { kind: "project", source: project },
    };
    if (earlier && !(await this.isLive({ projectId: earlier.targetProjectId }))) {
      return [
        {
          item: { ...projectStep.item, outcome: "skipped", reason: "target_project_gone" },
          work: null,
        },
      ];
    }
    return [projectStep, ...(await this.planContents({ project, source, placed }))];
  }

  private async isLive({ projectId }: { projectId: string }): Promise<boolean> {
    const live = await this.deps.projects.findById(projectId);
    return live !== null && live.archivedAt === null;
  }

  /** The allowlisted objects in one source project, each planned, already copied or skipped. */
  private async planContents({
    project,
    source,
    placed,
  }: {
    project: Project;
    source: Organization;
    placed: ReadonlyMap<string, Placed>;
  }): Promise<Step[]> {
    const at = { sourceProjectId: project.id };
    const [evaluators, monitors, prompts, datasets] = await Promise.all([
      this.deps.evaluators.getAll({ projectId: project.id }),
      this.deps.monitors.list({ projectId: project.id }),
      this.deps.prompts.getAllPrompts({
        projectId: project.id,
        organizationId: source.id,
        version: "latest",
      }),
      this.datasetsOf({ projectId: project.id }),
    ]);

    const step = (work: Work, name: string, skipped?: string): Step => {
      const base = { kind: work.kind, name, sourceId: work.source.id, ...at };
      const done = placed.get(keyOf(work.kind, work.source.id));
      if (done) return { item: copyItem(base, "already_copied", done), work };
      if (skipped) return { item: copyItem(base, "skipped", { reason: skipped }), work: null };
      return { item: copyItem(base, "planned"), work };
    };

    return [
      ...evaluators
        .filter((evaluator) => evaluator.archivedAt === null)
        .map((evaluator) =>
          step(
            { kind: "evaluator", source: evaluator },
            evaluator.name,
            evaluator.type === "workflow" ? "workflow_evaluator" : undefined,
          ),
        ),
      ...monitors.map((monitor) =>
        step(
          { kind: "monitor", source: monitor },
          monitor.name,
          monitor.experimentId ? "experiment_monitor" : undefined,
        ),
      ),
      ...prompts
        .filter((prompt) => prompt.projectId === project.id)
        .map((prompt) =>
          step(
            { kind: "prompt", source: prompt },
            prompt.handle ?? prompt.name,
            prompt.handle ? undefined : "unnamed_prompt",
          ),
        ),
      ...datasets.map((dataset) =>
        step(
          { kind: "dataset", source: dataset },
          dataset.name,
          dataset.status === "ready" ? undefined : "dataset_not_ready",
        ),
      ),
    ];
  }

  private async datasetsOf({ projectId }: { projectId: string }): Promise<DatasetSummary[]> {
    const datasets: DatasetSummary[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const answer = await this.deps.datasets.findDatasetSummaries({
        projectId,
        page,
        limit: DATASET_PAGE,
      });
      datasets.push(...answer);
      if (answer.length < DATASET_PAGE) break;
    }
    return datasets;
  }

  private async make({
    work,
    sourceProjectId,
    targetProjectId,
    run,
  }: {
    work: Work;
    sourceProjectId: string;
    targetProjectId: string | null;
    run: Run;
  }): Promise<Placed | { skipped: string }> {
    if (work.kind === "project") {
      const created = await this.deps.projects.createInOrganization({
        organizationId: run.target.id,
        userId: null,
        ...(await this.teamFor({ target: run.target, teams: run.teams })),
        name: work.source.name,
        language: work.source.language,
        framework: work.source.framework,
      });
      return { targetId: created.id, targetProjectId: created.id };
    }
    const projectId = targetProjectId as string;
    const into = (targetId: string) => ({ targetId, targetProjectId: projectId });
    switch (work.kind) {
      case "evaluator":
        return into(await this.copyEvaluator({ evaluator: work.source, projectId }));
      case "monitor":
        return this.copyMonitor({ monitor: work.source, projectId, placed: run.placed });
      case "prompt":
        return into(
          await this.copyPrompt({
            prompt: work.source,
            source: run.source,
            target: run.target,
            projectId,
          }),
        );
      case "dataset": {
        const copied = await this.deps.datasets.copyDataset({
          sourceDatasetId: work.source.id,
          sourceProjectId,
          targetProjectId: projectId,
        });
        return into(copied.id);
      }
    }
  }

  private async copyEvaluator({
    evaluator,
    projectId,
  }: {
    evaluator: Evaluator;
    projectId: string;
  }): Promise<string> {
    const created = await this.deps.evaluators.create({
      id: newEvaluatorId(),
      projectId,
      name: evaluator.name,
      ...(evaluator.slug ? { slug: evaluator.slug } : {}),
      type: evaluator.type as "evaluator" | "code",
      config: evaluatorConfigSchema.parse(evaluator.config ?? {}),
    });
    return created.id;
  }

  /** A copied monitor starts paused: it would run on the target's traces and spend there. */
  private async copyMonitor({
    monitor,
    projectId,
    placed,
  }: {
    monitor: MonitorWithEvaluator;
    projectId: string;
    placed: ReadonlyMap<string, Placed>;
  }): Promise<Placed | { skipped: string }> {
    const evaluatorId = monitor.evaluatorId
      ? placed.get(keyOf("evaluator", monitor.evaluatorId))?.targetId
      : undefined;
    if (monitor.evaluatorId && !evaluatorId) return { skipped: "evaluator_not_copied" };
    const created = await this.deps.monitors.create(
      monitorCreateInputSchema.parse({
        projectId,
        name: monitor.name,
        checkType: monitor.checkType,
        preconditions: monitor.preconditions,
        parameters: monitor.parameters,
        ...(monitor.mappings ? { mappings: monitor.mappings } : {}),
        sample: monitor.sample,
        executionMode: monitor.executionMode,
        ...(evaluatorId ? { evaluatorId } : {}),
        level: monitor.level === "thread" ? "thread" : "trace",
        threadIdleTimeout: monitor.threadIdleTimeout,
      }),
    );
    if (created.enabled) {
      await this.deps.monitors.toggle({ id: created.id, projectId, enabled: false });
    }
    return { targetId: created.id, targetProjectId: projectId };
  }

  /** Every version, oldest first, as new versions of one new prompt. */
  private async copyPrompt({
    prompt,
    source,
    target,
    projectId,
  }: {
    prompt: VersionedPrompt;
    source: Organization;
    target: Organization;
    projectId: string;
  }): Promise<string> {
    const versions = (
      await this.deps.prompts.getAllVersions({
        idOrHandle: prompt.id,
        projectId: prompt.projectId,
        organizationId: source.id,
      })
    ).toSorted((a, b) => a.version - b.version);
    const [first, ...later] = versions.length > 0 ? versions : [prompt];
    const created = await this.deps.prompts.createPrompt({
      projectId,
      organizationId: target.id,
      handle: prompt.handle as string,
      scope: prompt.scope,
      commitMessage: first?.commitMessage ?? null,
      ...promptFields(first as VersionedPrompt),
    });
    for (const version of later) {
      await this.deps.prompts.updatePrompt({
        idOrHandle: created.id,
        projectId,
        data: {
          commitMessage: version.commitMessage || `Version ${version.version}`,
          ...promptFields(version),
        },
      });
    }
    return created.id;
  }

  /** The target organization's first shared team, or a new team named after it. */
  private async teamFor({
    target,
    teams,
  }: {
    target: Organization;
    teams: Teams;
  }): Promise<{ teamId: string } | { newTeamName: string }> {
    if (!teams.looked) {
      const page = await this.deps.organizations.listTeams({
        organizationId: target.id,
        page: 1,
        limit: PAGE,
      });
      teams.teamId = page.data.find((team) => !team.isPersonal && team.archivedAt === null)?.id;
      teams.looked = true;
    }
    if (teams.teamId) return { teamId: teams.teamId };
    return { newTeamName: target.name };
  }
}
