import {
  DatasetCopyInterruptedError,
  type DatasetApi,
  type DatasetSummary,
} from "@langwatch/dataset-contract";
import {
  evaluatorConfigSchema,
  newEvaluatorId,
  type Evaluator,
  type EvaluatorApi,
} from "@langwatch/evaluator-contract";
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

import { copyKeyOf, promptFields } from "../rules/staff-access-copy.rules.ts";

const TEAMS_PAGE = 100;

type MakeDeps = Readonly<{
  organizations: Pick<OrganizationApi, "listTeams">;
  projects: Pick<ProjectApi, "createInOrganization">;
  evaluators: Pick<EvaluatorApi, "create">;
  monitors: Pick<MonitorApi, "create">;
  prompts: Pick<PromptApi, "getAllVersions" | "createPrompt" | "updatePrompt">;
  datasets: Pick<DatasetApi, "copyDataset">;
}>;

/** One source object the plan found, with what it carries to be copied. */
export type CopyWork =
  | { kind: "project"; source: Project }
  | { kind: "evaluator"; source: Evaluator }
  | { kind: "monitor"; source: MonitorWithEvaluator }
  | { kind: "prompt"; source: VersionedPrompt }
  | { kind: "dataset"; source: DatasetSummary };

export type CopyPlaced = Readonly<{ targetId: string; targetProjectId: string }>;
/** A made target; `incomplete` names what the owner refused after the target existed. */
export type CopyMade = CopyPlaced & Readonly<{ incomplete?: string }>;
type Organization = OrganizationProvisioningSummary;
type Teams = { teamId: string | undefined; looked: boolean };

/** What one execution carries from item to item. */
export type CopyRun = {
  requestId: string;
  source: Organization;
  target: Organization;
  placed: Map<string, CopyPlaced>;
  teams: Teams;
  /** What the target approval lets the copy create there, as signed. */
  grant: readonly string[];
  /** Why the copy must stop now, or null while both approvals are live. */
  stillLive: () => Promise<string | null>;
};

/**
 * Makes one copied item in the target through its owner's `*Api`, with plain create operations
 * so nothing in the target points back at the source organization.
 */
export class StaffAccessCopyMakeService {
  private constructor(private readonly deps: MakeDeps) {}

  static create(deps: MakeDeps): StaffAccessCopyMakeService {
    return new StaffAccessCopyMakeService(deps);
  }

  async make({
    work,
    sourceProjectId,
    targetProjectId,
    run,
  }: {
    work: CopyWork;
    sourceProjectId: string;
    targetProjectId: string | null;
    run: CopyRun;
  }): Promise<CopyMade | { skipped: string }> {
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
      case "prompt": {
        const copied = await this.copyPrompt({ prompt: work.source, run, projectId });
        return {
          ...into(copied.id),
          ...(copied.incomplete ? { incomplete: copied.incomplete } : {}),
        };
      }
      case "dataset":
        return this.copyDataset({ dataset: work.source, sourceProjectId, projectId });
    }
  }

  /** A dataset whose copy failed after it existed is recorded as made and incomplete. */
  private async copyDataset({
    dataset,
    sourceProjectId,
    projectId,
  }: {
    dataset: DatasetSummary;
    sourceProjectId: string;
    projectId: string;
  }): Promise<CopyMade> {
    try {
      const copied = await this.deps.datasets.copyDataset({
        sourceDatasetId: dataset.id,
        sourceProjectId,
        targetProjectId: projectId,
      });
      return { targetId: copied.id, targetProjectId: projectId };
    } catch (error) {
      if (!(error instanceof DatasetCopyInterruptedError)) throw error;
      return {
        targetId: error.targetDatasetId,
        targetProjectId: projectId,
        incomplete: "dataset_copy_incomplete",
      };
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
    placed: ReadonlyMap<string, CopyPlaced>;
  }): Promise<CopyPlaced | { skipped: string }> {
    const evaluatorId = monitor.evaluatorId
      ? placed.get(copyKeyOf("evaluator", monitor.evaluatorId))?.targetId
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
        enabled: false,
        executionMode: monitor.executionMode,
        ...(evaluatorId ? { evaluatorId } : {}),
        level: monitor.level === "thread" ? "thread" : "trace",
        threadIdleTimeout: monitor.threadIdleTimeout,
      }),
    );
    return { targetId: created.id, targetProjectId: projectId };
  }

  /**
   * Every version, oldest first, as new versions of one new prompt. Once the prompt exists a
   * refused version, or an approval that ended between versions, is reported, not thrown, so the
   * ledger records the prompt it made.
   */
  private async copyPrompt({
    prompt,
    run,
    projectId,
  }: {
    prompt: VersionedPrompt;
    run: CopyRun;
    projectId: string;
  }): Promise<{ id: string; incomplete?: string }> {
    const { source, target } = run;
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
    try {
      for (const version of later) {
        if ((await run.stillLive()) !== null) {
          return { id: created.id, incomplete: "prompt_versions_incomplete" };
        }
        await this.deps.prompts.updatePrompt({
          idOrHandle: created.id,
          projectId,
          data: {
            commitMessage: version.commitMessage || `Version ${version.version}`,
            ...promptFields(version),
          },
        });
      }
    } catch {
      return { id: created.id, incomplete: "prompt_versions_incomplete" };
    }
    return { id: created.id };
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
        limit: TEAMS_PAGE,
      });
      teams.teamId = page.data.find((team) => !team.isPersonal && team.archivedAt === null)?.id;
      teams.looked = true;
    }
    if (teams.teamId) return { teamId: teams.teamId };
    return { newTeamName: target.name };
  }
}
