import type { DatasetApi, DatasetSummary } from "@langwatch/dataset-contract";
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
  monitors: Pick<MonitorApi, "create" | "toggle">;
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
  }): Promise<CopyPlaced | { skipped: string }> {
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
        limit: TEAMS_PAGE,
      });
      teams.teamId = page.data.find((team) => !team.isPersonal && team.archivedAt === null)?.id;
      teams.looked = true;
    }
    if (teams.teamId) return { teamId: teams.teamId };
    return { newTeamName: target.name };
  }
}
