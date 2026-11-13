import type { EvaluationOutcome } from "@langwatch/evaluation-contract";
import { isProjectGone } from "@langwatch/eventing";
import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";
import type { RecordEvaluationOutcomeCommandData } from "@langwatch/trace-contract";
import { z } from "zod";

import type { TraceEvaluationRuns } from "../channels/trace-evaluation-runs.channel.ts";
import { boundedOutcomeCommand } from "../rules/trace-evaluation-analytics.rules.ts";
import type { TraceAnchorService } from "./trace-anchor.service.ts";
import type { TraceProcessingCommandsService } from "./trace-processing-commands.service.ts";

const PROJECT_PAGE_SIZE = 500;
const OUTCOME_PAGE_SIZE = 500;

/** How far back the backfill reaches: the stock widgets' longest period (60 days), plus two. */
export const EVALUATION_OUTCOMES_BACKFILL_HOURS = 62 * 24;

const outcomeCursorSchema = z.object({ occurredAt: z.number(), evaluationId: z.string() });

/** What the step saves after each page of outcomes and returns at the end. */
export const evaluationOutcomesBackfillReportSchema = z.object({
  sinceMs: z.number(),
  /** The last project whose outcomes were all sent; the next run lists projects after it. */
  afterProjectId: z.string().nullable(),
  /** A project part-sent when the run stopped, and the last outcome it sent. */
  inProject: z.object({ projectId: z.string(), after: outcomeCursorSchema }).nullable(),
  projects: z.number(),
  outcomes: z.number(),
  /** Outcomes whose trace is not stored (aged out, or never ingested), left unrecorded. */
  skippedWithoutTrace: z.number(),
  /** Projects archived or deleted since their evaluations, skipped whole. */
  skippedProjects: z.number().default(0),
});
export type EvaluationOutcomesBackfillReport = z.infer<
  typeof evaluationOutcomesBackfillReportSchema
>;

/** Where a run resumes, whether it writes, when it stops, and how it saves its progress. */
export interface EvaluationOutcomesBackfillInput {
  resumeFrom: EvaluationOutcomesBackfillReport | null;
  dryRun: boolean;
  signal: AbortSignal;
  onPage: (report: EvaluationOutcomesBackfillReport) => Promise<void>;
}

type TraceEvaluationOutcomesMigrationDependencies = Readonly<{
  projects: Pick<ProjectApi, "listAllWithOrganization">;
  evaluations: Pick<TraceEvaluationRuns, "listEvaluationOutcomes">;
  anchors: Pick<TraceAnchorService, "traceAnchors">;
  commands: Pick<TraceProcessingCommandsService, "recordEvaluationOutcomes">;
  logger: Readonly<{ warn(payload: Readonly<Record<string, unknown>>, message: string): void }>;
  now?: () => number;
}>;

/**
 * Records each project's finished evaluations of the last 62 days on their traces, one command
 * per outcome keyed by evaluation id, so a re-run sends the same commands and changes nothing.
 * Spec: specs/trace/trace-evaluation-analytics.feature
 */
export class TraceEvaluationOutcomesMigrationService {
  private readonly now: () => number;

  private constructor(private readonly deps: TraceEvaluationOutcomesMigrationDependencies) {
    this.now = deps.now ?? (() => nowInstant().epochMilliseconds);
  }

  static create(
    deps: TraceEvaluationOutcomesMigrationDependencies,
  ): TraceEvaluationOutcomesMigrationService {
    return new TraceEvaluationOutcomesMigrationService(deps);
  }

  async recordEvaluationOutcomes({
    resumeFrom,
    dryRun,
    signal,
    onPage,
  }: EvaluationOutcomesBackfillInput): Promise<EvaluationOutcomesBackfillReport> {
    let report = resumeFrom ?? this.firstReport();
    let after = report.afterProjectId ?? undefined;
    do {
      const page = await this.deps.projects.listAllWithOrganization({
        after,
        limit: PROJECT_PAGE_SIZE,
      });
      for (const { id: projectId } of page.projects) {
        let latest = report;
        try {
          report = await this.recordProject({
            projectId,
            report,
            dryRun,
            signal,
            onPage: async (saved) => {
              latest = saved;
              await onPage(saved);
            },
          });
        } catch (error) {
          // Pages of this project already sent keep their counts: carry on from the last saved one.
          if (!isProjectGone(error)) throw error;
          report = latest;
          this.deps.logger.warn(
            { projectId },
            "the evaluation outcomes step skipped a project that is archived or gone",
          );
          report = { ...report, skippedProjects: report.skippedProjects + 1 };
        }
        if (signal.aborted) return report;
        report = { ...report, afterProjectId: projectId, inProject: null };
        if (!dryRun) await onPage(report);
      }
      after = page.next ?? undefined;
    } while (after !== undefined);
    return report;
  }

  private firstReport(): EvaluationOutcomesBackfillReport {
    return {
      sinceMs: this.now() - EVALUATION_OUTCOMES_BACKFILL_HOURS * 60 * 60 * 1000,
      afterProjectId: null,
      inProject: null,
      projects: 0,
      outcomes: 0,
      skippedWithoutTrace: 0,
      skippedProjects: 0,
    };
  }

  /** Sends one project's outcomes page by page, saving after each page it sends. */
  private async recordProject({
    projectId,
    report,
    dryRun,
    signal,
    onPage,
  }: {
    projectId: string;
    report: EvaluationOutcomesBackfillReport;
    dryRun: boolean;
    signal: AbortSignal;
    onPage: (report: EvaluationOutcomesBackfillReport) => Promise<void>;
  }): Promise<EvaluationOutcomesBackfillReport> {
    let next = report;
    let cursor = report.inProject?.projectId === projectId ? report.inProject.after : null;
    let sentAny = cursor !== null;
    while (!signal.aborted) {
      const page = await this.deps.evaluations.listEvaluationOutcomes({
        tenantId: projectId,
        sinceMs: report.sinceMs,
        after: cursor,
        limit: OUTCOME_PAGE_SIZE,
      });
      const last = page.outcomes.at(-1);
      if (last === undefined) break;
      const commands = await this.commandsFor({ projectId, outcomes: page.outcomes });
      if (!dryRun && commands.length > 0)
        await this.deps.commands.recordEvaluationOutcomes(commands);
      cursor = { occurredAt: last.occurredAt, evaluationId: last.evaluationId };
      next = {
        ...next,
        projects: sentAny ? next.projects : next.projects + 1,
        outcomes: next.outcomes + commands.length,
        skippedWithoutTrace: next.skippedWithoutTrace + page.outcomes.length - commands.length,
        inProject: { projectId, after: cursor },
      };
      sentAny = true;
      if (!dryRun) await onPage(next);
      if (page.next === null) break;
    }
    return next;
  }

  /** The page's outcomes whose trace is stored, each stamped with that trace's OccurredAt. */
  private async commandsFor({
    projectId,
    outcomes,
  }: {
    projectId: string;
    outcomes: readonly EvaluationOutcome[];
  }): Promise<RecordEvaluationOutcomeCommandData[]> {
    const anchors = await this.deps.anchors.traceAnchors({
      tenantId: projectId,
      traces: outcomes.map((outcome) => ({ traceId: outcome.traceId, nearMs: outcome.occurredAt })),
      purpose: { kind: "operator", entry: "TraceEvaluationOutcomesMigrationService" },
    });
    const nowMs = this.now();
    return outcomes.flatMap((outcome) => {
      const occurredAt = anchors.get(outcome.traceId);
      if (occurredAt === undefined) return [];
      const command = {
        tenantId: projectId,
        traceId: outcome.traceId,
        occurredAt,
        idempotencyKey: `${projectId}:${outcome.traceId}:evaluation-outcome:backfill:${outcome.evaluationId}`,
        evaluationId: outcome.evaluationId,
        evaluatorName: outcome.evaluatorName,
        isGuardrail: outcome.isGuardrail,
        status: outcome.status,
        passed: outcome.passed,
        label: outcome.label,
        evaluationOccurredAt: outcome.occurredAt,
        // The run's last event, so the live event for the same fact ties and changes nothing.
        sourceEventId: outcome.lastEventId || `backfill:${outcome.evaluationId}`,
      };
      return [boundedOutcomeCommand({ command, nowMs })];
    });
  }
}
