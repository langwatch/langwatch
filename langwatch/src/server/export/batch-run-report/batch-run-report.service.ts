import type { generateObject } from "ai";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { buildEvidenceBlock } from "./evidence/evidence-block";
import { buildEvidence, TREND_WINDOW } from "./evidence/evidence-builder";
import { buildRunSummary } from "./evidence/run-summary";
import { selectTranscripts } from "./evidence/transcript-budget";
import { assembleSections, collectClaims } from "./narrative/assemble";
import { runNarrativePass } from "./narrative/narrative-pass";
import { runVerifierPass } from "./narrative/verifier-pass";
import { QUESTION_REGISTRY } from "./questions/question-registry";
import type { BatchRunReportReader } from "./reader";
import type {
  BatchRunReportRequest,
  ReportEvidence,
  ReportModel,
  ReportTier,
} from "./report.types";

type ModelHandle = Parameters<typeof generateObject>[0]["model"];
type ResolveModel = (params: {
  projectId: string;
  featureKey: string;
}) => Promise<ModelHandle>;

/**
 * How far back the batch history is read before the window is applied.
 *
 * The history arrives newest first and everything at or after the run being
 * reported on is discarded, so reading exactly one window's worth would find
 * nothing to compare against whenever the run is not the latest.
 */
const HISTORY_READ_LIMIT = 100;

/** A run with no scenarios in it is not a run this project can report on. */
export class BatchRunNotFoundError extends Error {
  constructor(batchRunId: string) {
    super(`No runs found for batch ${batchRunId}`);
    this.name = "BatchRunNotFoundError";
  }
}

/**
 * Produces one report for one run.
 *
 * Deliberately HTTP-unaware: it takes a request and returns a model. Nothing
 * here knows about streaming, headers or downloads, so if this ever needs to
 * move behind a job it is a wiring change rather than a rewrite.
 *
 * The three stages degrade independently and none of them can fail the report:
 * the figures always compute, the writing may not arrive, and the check may not
 * arrive. What the reader gets is named by the tier.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */
export class BatchRunReportService {
  private constructor(
    private readonly reader: BatchRunReportReader,
    private readonly resolveModel: ResolveModel,
  ) {}

  static create({
    reader,
    resolveModel = ({ projectId, featureKey }) =>
      getVercelAIModel({ projectId, featureKey }) as Promise<ModelHandle>,
  }: {
    reader: BatchRunReportReader;
    resolveModel?: ResolveModel;
  }): BatchRunReportService {
    return new BatchRunReportService(reader, resolveModel);
  }

  async generate({
    request,
    generatedAt,
    abortSignal,
  }: {
    request: BatchRunReportRequest;
    /** Passed in so the same unchanged run renders the same file twice. */
    generatedAt: string;
    abortSignal?: AbortSignal;
  }): Promise<ReportModel> {
    const { evidence, evidenceBlock } = await this.readEvidence(request);
    const { draft, verdicts, unchecked } = await this.runModelPasses({
      request,
      evidence,
      evidenceBlock,
      abortSignal,
    });

    const { sections, integrity } = verdicts?.usable
      ? assembleSections({
          evidence,
          questions: QUESTION_REGISTRY,
          draft,
          verdicts,
        })
      : unchecked;

    const tier = resolveTier({ draft, verdicts });
    integrity.notes.push(...buildNotes({ evidence, tier }));

    return {
      meta: {
        projectId: request.projectId,
        suiteName: request.suiteName ?? request.scenarioSetId,
        batchRunId: request.batchRunId,
        generatedAt,
      },
      tier,
      summary: buildRunSummary({ evidence }),
      headline: { passRate: evidence.passRate, counts: evidence.counts },
      sections,
      integrity,
    };
  }

  /** The computed half: everything the report can say with no model at all. */
  private async readEvidence(request: BatchRunReportRequest): Promise<{
    evidence: ReportEvidence;
    evidenceBlock: string;
  }> {
    const runs = await this.readRuns(request);
    if (runs.length === 0) {
      throw new BatchRunNotFoundError(request.batchRunId);
    }

    const { priorRuns, priorBatchOrder } = await this.readHistory({
      request,
      // The trend is only allowed to look backwards, so it needs to know when
      // this run happened. Taken from the runs already read rather than from
      // the history, which may not reach far enough back to contain this batch.
      startedAt: runs.reduce(
        (earliest, run) => Math.min(earliest, run.timestamp),
        Number.POSITIVE_INFINITY,
      ),
    });
    const evidence = buildEvidence({
      runs,
      priorRuns,
      priorBatchOrder,
      batchRunId: request.batchRunId,
      scenarioSetId: request.scenarioSetId,
      suiteName: request.suiteName ?? null,
    });

    const selection = selectTranscripts({
      signatures: evidence.signatures,
      runFacts: evidence.runs,
      runsById: new Map(runs.map((run) => [run.scenarioRunId, run])),
    });
    evidence.truncation.transcriptsIncluded = selection.transcripts.length;
    evidence.truncation.signaturesCovered = selection.signaturesCovered;
    // Kept on the evidence so the deterministic layer can show a reader the
    // same conversations the model was given. Selection is model-free, so the
    // replay renders at every tier, including when no model ran at all.
    evidence.transcripts = selection.transcripts;

    return {
      evidence,
      // Built once and handed to both passes, so the checker provably saw the
      // same facts as the writer rather than a regenerated approximation.
      evidenceBlock: buildEvidenceBlock({
        evidence,
        transcripts: selection.transcripts,
      }),
    };
  }

  /**
   * The written half, and the check on it.
   *
   * Assembly is what gives claims their ids, and the checker can only rule on
   * claims that exist — so assemble once to produce them, check them, and let
   * the caller assemble again with the verdicts. Pure function, same inputs:
   * the second assembly differs only by what the check removed.
   */
  private async runModelPasses({
    request,
    evidence,
    evidenceBlock,
    abortSignal,
  }: {
    request: BatchRunReportRequest;
    evidence: ReportEvidence;
    evidenceBlock: string;
    abortSignal?: AbortSignal;
  }): Promise<{
    draft: Awaited<ReturnType<typeof runNarrativePass>>;
    verdicts: Awaited<ReturnType<typeof runVerifierPass>>;
    unchecked: ReturnType<typeof assembleSections>;
  }> {
    const draft = await runNarrativePass({
      evidenceBlock,
      questions: QUESTION_REGISTRY,
      resolveModel: () =>
        this.resolveModel({
          projectId: request.projectId,
          featureKey: "scenarios.run_report",
        }),
      abortSignal,
    });

    const unchecked = assembleSections({
      evidence,
      questions: QUESTION_REGISTRY,
      draft,
      verdicts: null,
    });

    const verdicts = draft
      ? await runVerifierPass({
          evidenceBlock,
          claims: collectClaims(unchecked.sections),
          resolveModel: () =>
            this.resolveModel({
              projectId: request.projectId,
              featureKey: "scenarios.run_report_check",
            }),
          abortSignal,
        })
      : null;

    return { draft, verdicts, unchecked };
  }

  private async readRuns(
    request: BatchRunReportRequest,
  ): Promise<ScenarioRunData[]> {
    const result = await this.reader.getRunDataForBatchRun({
      projectId: request.projectId,
      scenarioSetId: request.scenarioSetId,
      batchRunId: request.batchRunId,
    });
    return result.changed ? result.runs : [];
  }

  /**
   * The runs before this one, oldest first.
   *
   * Read without transcripts: the comparison needs each run's criteria and
   * nothing else, and pulling conversations for ten previous runs would cost
   * far more than the answer is worth.
   */
  private async readHistory({
    request,
    startedAt,
  }: {
    request: BatchRunReportRequest;
    startedAt: number;
  }): Promise<{
    priorRuns: ScenarioRunData[];
    priorBatchOrder: string[];
  }> {
    const history = await this.reader.getBatchHistoryForScenarioSet({
      projectId: request.projectId,
      scenarioSetId: request.scenarioSetId,
      // Read wider than the window, because the history comes back newest
      // first and everything after this run is about to be discarded. Reporting
      // on a run from a fortnight ago should still find the runs before it.
      limit: HISTORY_READ_LIMIT,
    });

    const priorBatchOrder = history.batches
      .filter(
        (batch) =>
          batch.batchRunId !== request.batchRunId &&
          // Strictly earlier. Without this the newest batches in the set are
          // taken as "previous" no matter which run is being reported on, so
          // exporting an older run compares it against its own future and
          // reverses every verdict: a criterion that starts passing later
          // reads as a regression.
          batch.lastRunAt < startedAt,
      )
      .sort((a, b) => a.lastRunAt - b.lastRunAt)
      .slice(-TREND_WINDOW)
      .map((batch) => batch.batchRunId);

    if (priorBatchOrder.length === 0) {
      return { priorRuns: [], priorBatchOrder: [] };
    }

    const priorRuns = await this.reader.findRunOutcomesForBatchIds({
      projectId: request.projectId,
      scenarioSetId: request.scenarioSetId,
      batchRunIds: priorBatchOrder,
    });

    return { priorRuns, priorBatchOrder };
  }
}

function resolveTier({
  draft,
  verdicts,
}: {
  draft: unknown | null;
  verdicts: { usable: boolean } | null;
}): ReportTier {
  if (draft === null) return "figures_only";
  return verdicts?.usable ? "verified" : "unchecked";
}

function buildNotes({
  evidence,
  tier,
}: {
  evidence: ReportEvidence;
  tier: ReportTier;
}): string[] {
  const notes: string[] = [];

  if (tier === "figures_only") {
    notes.push(
      "No written analysis was produced for this report, so it contains the figures only.",
    );
  }
  if (tier === "unchecked") {
    notes.push(
      "The written analysis could not be independently checked against the run data.",
    );
  }
  if (
    evidence.truncation.failingRuns > evidence.truncation.transcriptsIncluded
  ) {
    notes.push(
      `The analysis read ${evidence.truncation.transcriptsIncluded} of ${evidence.truncation.failingRuns} failing conversations, covering ${evidence.truncation.signaturesCovered} of ${evidence.truncation.signaturesTotal} distinct failure groups.`,
    );
  }
  if (evidence.stillRunning) {
    notes.push(
      "Some scenarios had not finished, so this report covers only those that had.",
    );
  }

  return notes;
}
