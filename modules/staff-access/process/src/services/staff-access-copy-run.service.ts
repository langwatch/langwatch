import type { DatasetApi, DatasetSummary } from "@langwatch/dataset-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { generate } from "@langwatch/ksuid";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type {
  OrganizationApi,
  OrganizationProvisioningSummary,
} from "@langwatch/organization-contract";
import type { Project, ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { StaffAccessCopyItem, StaffAccessCopyKind } from "@langwatch/staff-access-contract";
import type { Instant } from "@langwatch/time";

import type { StaffAccessCopyLedgerRepository } from "../repositories/staff-access.repository.ts";
import {
  copyItem,
  copyKeyOf as keyOf,
  failureReason,
  selectProjects,
  withinGrant,
} from "../rules/staff-access-copy.rules.ts";
import {
  StaffAccessCopyMakeService,
  type CopyPlaced as Placed,
  type CopyRun as Run,
  type CopyWork as Work,
} from "./staff-access-copy-make.service.ts";

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

type Step = Readonly<{ item: StaffAccessCopyItem; work: Work | null }>;
type Organization = OrganizationProvisioningSummary;

/** Why a run stopped early, or null while both approvals are still live. */
export type CopyLiveness = () => Promise<string | null>;

export type StaffAccessCopyPlan = Readonly<{
  items: StaffAccessCopyItem[];
  steps: readonly Step[];
  /** `${kind}:${sourceId}` -> where an earlier copy put it. */
  placed: ReadonlyMap<string, Placed>;
}>;

/**
 * Reads what a copy would make and makes it, through each owner's `*Api` only. The allowlist is
 * the kinds below; anything else in the organization is never read. A rerun skips every object
 * the ledger says an earlier copy made, so it adds only what is new.
 */
export class StaffAccessCopyRunService {
  readonly #make: StaffAccessCopyMakeService;

  private constructor(private readonly deps: RunDeps) {
    this.#make = StaffAccessCopyMakeService.create(deps);
  }

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

  /**
   * Makes every planned item in order, each on its own: one failure never stops the rest. Before
   * each item it asks whether both approvals are still live; once one is not, every remaining
   * planned item is reported `stopped` and nothing more is made.
   */
  async execute({
    plan,
    requestId,
    source,
    target,
    grant,
    stillLive,
  }: {
    plan: StaffAccessCopyPlan;
    requestId: string;
    source: Organization;
    target: Organization;
    grant: readonly string[];
    stillLive: CopyLiveness;
  }): Promise<{ items: StaffAccessCopyItem[]; stoppedBecause: string | null }> {
    const run: Run = {
      requestId,
      source,
      target,
      placed: new Map(plan.placed),
      teams: { teamId: undefined, looked: false },
      grant,
    };
    const items: StaffAccessCopyItem[] = [];
    let stoppedBecause: string | null = null;
    for (const step of plan.steps) {
      const due = step.item.outcome === "planned" && step.work !== null;
      if (due && stoppedBecause === null) {
        stoppedBecause = await stillLive();
      }
      if (due && stoppedBecause !== null) {
        items.push({ ...step.item, outcome: "stopped", reason: stoppedBecause });
        continue;
      }
      items.push(await this.runStep({ step, run }));
    }
    return { items, stoppedBecause };
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
    if (!withinGrant({ kind: step.item.kind, grant: run.grant })) {
      return { ...step.item, outcome: "skipped", reason: "outside_copy_grant" };
    }
    try {
      const made = await this.#make.make({
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
}
