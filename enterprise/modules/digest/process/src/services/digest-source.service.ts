// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  MetricFactsContribution,
  SpanFactsContribution,
} from "@langwatch/coding-agent-contract";
import type { EvaluationLifecycleCompletedEventData } from "@langwatch/evaluation-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import type { SimulationRunFinishedEventData } from "@langwatch/scenario-contract";
import type { NormalizedSpan } from "@langwatch/trace-contract";

import type {
  ProjectActivity,
  ProjectFact,
  UserActivity,
} from "../eventing/digest-activity.events.ts";
import type { DigestAudienceRepository } from "../repositories/digest-audience.repository.ts";
import {
  evaluationFact,
  extractRepository,
  metricSeries,
  scenarioFact,
  spanFact,
} from "../rules/digest-activity.rules.ts";
import { isoWeekOf } from "../rules/digest-week.rules.ts";

const logger = createLogger("langwatch:digest");

/** How stale this process's view of the enrolled cohort may be before it is read again. */
const COHORT_REFRESH_MS = 60 * 1000;
/** ponytail: an in-process memo, cleared whole when full; a shared cache if the fleet grows. */
const MAX_REMEMBERED_OWNERS = 10_000;

/** Each enrolled organization's projects, by project id. */
type Cohort = Readonly<{ organizationOf: ReadonlyMap<string, string>; loadedAt: number }>;

type Deps = Readonly<{
  audience: Pick<DigestAudienceRepository, "findEnrolled">;
  projects: Pick<ProjectApi, "listIdsByOrganization" | "findPersonalWorkspaceOwner">;
  recordProject: (activity: ProjectActivity) => Promise<void>;
  recordUser: (activity: UserActivity) => Promise<void>;
  now: () => number;
}>;

/**
 * Turns each owner's event into digest's own fact and sends it (§9's subscriber rule): the
 * owners never name digest. Only projects of enrolled organizations fold, so an empty cohort
 * folds nothing and stores nothing.
 */
export class DigestSourceService {
  static create(deps: Deps): DigestSourceService {
    return new DigestSourceService(deps);
  }

  #cohort: Cohort | undefined;
  #loading: Promise<Cohort> | undefined;
  readonly #owners = new Map<string, Promise<string | null>>();

  private constructor(private readonly deps: Deps) {}

  /**
   * The enqueue filter's answer, synchronous: a project outside the cohort mints no job. While
   * the view is unread or stale it lets everything through and reads it again; the handler asks.
   */
  mayFold(projectId: string): boolean {
    const cohort = this.#cohort;
    if (cohort && !this.#isStale(cohort)) return cohort.organizationOf.has(projectId);
    void this.#refresh().catch((error: unknown) => {
      logger.warn({ error }, "the digest could not read its cohort; letting the project through");
    });
    return true;
  }

  spanRecorded(span: NormalizedSpan): Promise<void> {
    return this.#project({
      projectId: span.tenantId,
      // The span's own start, as the client reported it, decides its week (ADR-001, Runtime).
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
    const organizationId = (await this.#current()).organizationOf.get(projectId);
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
    const organizationId = (await this.#current()).organizationOf.get(projectId);
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
    if (this.#owners.size >= MAX_REMEMBERED_OWNERS) this.#owners.clear();
    const lookup = this.deps.projects
      .findPersonalWorkspaceOwner({ organizationId, scopeId: projectId })
      .then((owner) => owner?.ownerUserId ?? null);
    this.#owners.set(projectId, lookup);
    void lookup.catch(() => this.#owners.delete(projectId));
    return lookup;
  }

  #isStale(cohort: Cohort): boolean {
    return this.deps.now() - cohort.loadedAt >= COHORT_REFRESH_MS;
  }

  async #current(): Promise<Cohort> {
    const cohort = this.#cohort;
    return cohort && !this.#isStale(cohort) ? cohort : this.#refresh();
  }

  #refresh(): Promise<Cohort> {
    this.#loading ??= this.#load().finally(() => {
      this.#loading = undefined;
    });
    return this.#loading;
  }

  async #load(): Promise<Cohort> {
    const enrolled = await this.deps.audience.findEnrolled();
    const pairs = await Promise.all(
      enrolled.map(async (organizationId) =>
        (await this.deps.projects.listIdsByOrganization({ organizationId })).map(
          (projectId): [string, string] => [projectId, organizationId],
        ),
      ),
    );
    const cohort: Cohort = { organizationOf: new Map(pairs.flat()), loadedAt: this.deps.now() };
    this.#cohort = cohort;
    return cohort;
  }
}
