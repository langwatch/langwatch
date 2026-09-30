// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  MetricFactsContribution,
  SpanFactsContribution,
} from "@langwatch/coding-agent-contract";
import type { EvaluationLifecycleCompletedEventData } from "@langwatch/evaluation-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { SimulationRunFinishedEventData } from "@langwatch/scenario-contract";
import type { SuiteRunItemCompletedEventData } from "@langwatch/suite-contract";
import type { NormalizedSpan } from "@langwatch/trace-contract";

import type {
  ProjectActivity,
  ProjectFact,
  UserActivity,
} from "../eventing/digest-activity.events.ts";
import {
  evaluationFact,
  metricSeries,
  repositoryOf,
  scenarioFact,
  spanFact,
  suiteItemFact,
} from "../rules/digest-activity.rules.ts";
import { isoWeekOf } from "../rules/digest-week.rules.ts";

type ProjectOwner = Readonly<{ organizationId: string; ownerUserId: string | null }>;

/** ponytail: an in-process memo, cleared whole when full; a shared cache if the fleet grows. */
const MAX_REMEMBERED_PROJECTS = 10_000;

/**
 * Turns each owner's event into the digest's own fact and sends it (§9's subscriber rule): the
 * owners never name digest. A project digest cannot place in an organization is skipped.
 */
export class DigestSourceService {
  static create(deps: {
    projects: Pick<ProjectApi, "findOrganizationId" | "findPersonalWorkspaceOwner">;
    recordProject: (activity: ProjectActivity) => Promise<void>;
    recordUser: (activity: UserActivity) => Promise<void>;
    now: () => number;
  }): DigestSourceService {
    return new DigestSourceService(deps);
  }

  readonly #owners = new Map<string, Promise<ProjectOwner | null>>();

  private constructor(
    private readonly deps: {
      projects: Pick<ProjectApi, "findOrganizationId" | "findPersonalWorkspaceOwner">;
      recordProject: (activity: ProjectActivity) => Promise<void>;
      recordUser: (activity: UserActivity) => Promise<void>;
      now: () => number;
    },
  ) {}

  spanRecorded(span: NormalizedSpan): Promise<void> {
    return this.#project({
      projectId: span.tenantId,
      occurredAt: span.startTimeUnixMs,
      sourceKey: `span:${span.traceId}:${span.spanId}`,
      fact: spanFact(span),
    });
  }

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
  }: {
    data: SimulationRunFinishedEventData;
    projectId: string;
  }): Promise<void> {
    return this.#project({
      projectId,
      occurredAt: this.deps.now(),
      sourceKey: `scenario:${data.scenarioRunId}`,
      fact: scenarioFact(data),
    });
  }

  suiteItemCompleted({
    data,
    projectId,
  }: {
    data: SuiteRunItemCompletedEventData;
    projectId: string;
  }): Promise<void> {
    return this.#project({
      projectId,
      occurredAt: this.deps.now(),
      sourceKey: `suite:${data.batchRunId}:${data.scenarioRunId}`,
      fact: suiteItemFact(data),
    });
  }

  codingAgentSpan(data: SpanFactsContribution): Promise<void> {
    return this.#user({
      contribution: data,
      sourceKey: `coding-agent-span:${data.traceId}:${data.spanId}`,
      repository: repositoryOf(data),
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
    const owner = await this.#ownerOf(projectId);
    if (!owner) return;
    await this.deps.recordProject({
      tenantId: projectId,
      occurredAt,
      projectId,
      organizationId: owner.organizationId,
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
    const owner = await this.#ownerOf(contribution.tenantId);
    if (!owner?.ownerUserId) return;
    await this.deps.recordUser({
      tenantId: contribution.tenantId,
      occurredAt: contribution.occurredAt,
      userId: owner.ownerUserId,
      organizationId: owner.organizationId,
      isoWeek: isoWeekOf(contribution.occurredAt),
      sourceKey,
      sessionId: contribution.sessionId,
      repository,
      series,
    });
  }

  #ownerOf(projectId: string): Promise<ProjectOwner | null> {
    const known = this.#owners.get(projectId);
    if (known) return known;
    if (this.#owners.size >= MAX_REMEMBERED_PROJECTS) this.#owners.clear();
    const lookup = this.#lookUpOwner(projectId);
    this.#owners.set(projectId, lookup);
    lookup.catch(() => this.#owners.delete(projectId));
    return lookup;
  }

  async #lookUpOwner(projectId: string): Promise<ProjectOwner | null> {
    const organizationId = await this.deps.projects.findOrganizationId(projectId);
    if (!organizationId) return null;
    const personal = await this.deps.projects.findPersonalWorkspaceOwner({
      organizationId,
      scopeId: projectId,
    });
    return { organizationId, ownerUserId: personal?.ownerUserId ?? null };
  }
}
