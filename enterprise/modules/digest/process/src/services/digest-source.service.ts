// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  MetricFactsContribution,
  SpanFactsContribution,
} from "@langwatch/coding-agent-contract";
import type { EvaluationLifecycleCompletedEventData } from "@langwatch/evaluation-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { SimulationRunFinishedEventData } from "@langwatch/scenario-contract";

import type {
  ProjectActivity,
  ProjectFact,
  UserActivity,
} from "../eventing/digest-activity.events.ts";
import {
  evaluationFact,
  extractRepository,
  metricSeries,
  scenarioFact,
} from "../rules/digest-activity.rules.ts";
import { isoWeekOf } from "../rules/digest-week.rules.ts";

/** ponytail: in-process memos, cleared whole when full; a shared cache if the fleet grows. */
const MAX_REMEMBERED = 10_000;

type Deps = Readonly<{
  projects: Pick<ProjectApi, "findOrganizationId" | "findPersonalWorkspaceOwner">;
  recordProject: (activity: ProjectActivity) => Promise<void>;
  recordUser: (activity: UserActivity) => Promise<void>;
}>;

/**
 * Turns each owner's event into digest's own fact and sends it (§9's subscriber rule): the
 * owners never name digest. Every project folds, under the organization it belongs to; a project
 * with no organization folds nothing.
 */
export class DigestSourceService {
  static create(deps: Deps): DigestSourceService {
    return new DigestSourceService(deps);
  }

  /** A project's organization never changes, so a lookup is remembered, absent answers too. */
  readonly #organizations = new Map<string, Promise<string | null>>();
  readonly #owners = new Map<string, Promise<string | null>>();

  private constructor(private readonly deps: Deps) {}

  evaluationCompleted(data: EvaluationLifecycleCompletedEventData): Promise<void> {
    return this.#project({
      projectId: data.projectId,
      occurredAt: data.occurredAt,
      sourceKey: `evaluation:${data.evaluationId}`,
      fact: evaluationFact(data),
    });
  }

  scenarioFinished({
    data,
    projectId,
    occurredAt,
  }: {
    data: SimulationRunFinishedEventData;
    projectId: string;
    occurredAt: number;
  }): Promise<void> {
    return this.#project({
      projectId,
      occurredAt: data.occurredAt ?? occurredAt,
      sourceKey: `scenario:${data.scenarioRunId}`,
      fact: scenarioFact(data),
    });
  }

  codingAgentSpan(data: SpanFactsContribution): Promise<void> {
    return this.#user({
      contribution: data,
      sourceKey: `coding-agent-span:${data.traceId}:${data.spanId}`,
      repository: extractRepository(data) ?? null,
      series: null,
    });
  }

  async codingAgentMetric(data: MetricFactsContribution): Promise<void> {
    const series = metricSeries(data);
    if (series === null) return;
    await this.#user({
      contribution: data,
      sourceKey: `coding-agent-metric:${data.seriesId}:${data.asOfUnixMs}`,
      repository: null,
      series,
    });
  }

  async #project({
    projectId,
    occurredAt,
    sourceKey,
    fact,
  }: {
    projectId: string;
    occurredAt: number;
    sourceKey: string;
    fact: ProjectFact;
  }): Promise<void> {
    const organizationId = await this.#organizationOf(projectId);
    if (!organizationId) return;
    await this.deps.recordProject({
      tenantId: projectId,
      occurredAt,
      projectId,
      organizationId,
      isoWeek: isoWeekOf(occurredAt),
      sourceKey,
      fact,
    });
  }

  async #user({
    contribution,
    sourceKey,
    repository,
    series,
  }: {
    contribution: Pick<SpanFactsContribution, "tenantId" | "sessionId" | "occurredAt">;
    sourceKey: string;
    repository: string | null;
    series: UserActivity["series"];
  }): Promise<void> {
    const projectId = contribution.tenantId;
    const organizationId = await this.#organizationOf(projectId);
    if (!organizationId) return;
    const userId = await this.#ownerOf({ projectId, organizationId });
    if (!userId) return;
    await this.deps.recordUser({
      tenantId: projectId,
      occurredAt: contribution.occurredAt,
      userId,
      organizationId,
      isoWeek: isoWeekOf(contribution.occurredAt),
      sourceKey,
      sessionId: contribution.sessionId,
      repository,
      series,
    });
  }

  /** A coding-agent fact is a person's only when it came from their personal project. */
  #ownerOf({
    projectId,
    organizationId,
  }: {
    projectId: string;
    organizationId: string;
  }): Promise<string | null> {
    const known = this.#owners.get(projectId);
    if (known) return known;
    if (this.#owners.size >= MAX_REMEMBERED) this.#owners.clear();
    const lookup = this.deps.projects
      .findPersonalWorkspaceOwner({ organizationId, scopeId: projectId })
      .then((owner) => owner?.ownerUserId ?? null);
    this.#owners.set(projectId, lookup);
    void lookup.catch(() => this.#owners.delete(projectId));
    return lookup;
  }

  #organizationOf(projectId: string): Promise<string | null> {
    const known = this.#organizations.get(projectId);
    if (known) return known;
    if (this.#organizations.size >= MAX_REMEMBERED) this.#organizations.clear();
    const lookup = this.deps.projects
      .findOrganizationId(projectId)
      .then((organizationId) => organizationId ?? null);
    this.#organizations.set(projectId, lookup);
    void lookup.catch(() => this.#organizations.delete(projectId));
    return lookup;
  }
}
