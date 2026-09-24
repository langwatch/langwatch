import { type EvaluationApi, LangevalsPiiDetectionError } from "@langwatch/evaluation-contract";
import { normalizePresidioMarkers } from "@langwatch/redaction";
import type { PIIRedactionLevel } from "@langwatch/trace-contract";

import type { PiiAnalysisMetrics } from "../app/data-privacy.members.ts";
import { PII_ANALYSIS_TEXT_BUDGET, presidioEntitiesFor } from "../rules/pii-analysis.rules.ts";

type PiiDetection = Pick<EvaluationApi, "detectPii">;

/** A batch through langevals' Presidio, reached through evaluation: main's `clearPresidio`. */
export class PresidioRedactionService {
  static create(input: {
    evaluation: PiiDetection;
    metrics: PiiAnalysisMetrics;
    timeoutMs: number;
  }): PresidioRedactionService {
    return new PresidioRedactionService(input.evaluation, input.metrics, input.timeoutMs);
  }

  #configured: Promise<boolean> | undefined;

  private constructor(
    private readonly evaluation: PiiDetection,
    private readonly metrics: PiiAnalysisMetrics,
    private readonly timeoutMs: number,
  ) {}

  /** Asked once, with an empty batch that sends nothing; a failed answer is asked again. */
  isConfigured(): Promise<boolean> {
    this.#configured ??= this.evaluation
      .detectPii({ texts: [], entities: [], signal: new AbortController().signal })
      .then((outcome) => outcome.kind !== "not_configured")
      .catch((error: unknown) => {
        this.#configured = undefined;
        throw error;
      });
    return this.#configured;
  }

  /** One anonymized text per input, or null where Presidio left it as it was. */
  async clear(input: {
    texts: readonly string[];
    piiRedactionLevel: PIIRedactionLevel;
    entities?: readonly string[] | undefined;
    projectId?: string | undefined;
  }): Promise<(string | null)[]> {
    if (input.texts.length === 0) return [];

    this.metrics.analysisCalled("presidio");
    const truncated = input.texts.map((text) => ({
      input: text.slice(0, PII_ANALYSIS_TEXT_BUDGET),
      remaining: text.slice(PII_ANALYSIS_TEXT_BUDGET),
    }));
    const startedAt = performance.now();
    const outcome = await this.#detect({ ...input, texts: truncated.map((t) => t.input) });
    this.metrics.analysisObserved(performance.now() - startedAt);

    if (outcome.kind === "not_configured") {
      throw new Error("LANGEVALS_ENDPOINT is not set, PII check cannot be performed");
    }

    return truncated.map((entry, i) => {
      const result = outcome.results[i];
      if (!result) throw new Error(`Presidio returned no result for text ${i}`);
      this.metrics.analysisFinished(result.status);
      if (result.status === "error") throw new Error(result.details);
      const anonymized: unknown =
        result.status === "processed" ? result.raw_response?.anonymized : undefined;
      return typeof anonymized === "string" && anonymized
        ? normalizePresidioMarkers(anonymized) + entry.remaining
        : null;
    });
  }

  async #detect(input: {
    texts: readonly string[];
    piiRedactionLevel: PIIRedactionLevel;
    entities?: readonly string[] | undefined;
    projectId?: string | undefined;
  }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = performance.now();
    try {
      return await this.evaluation.detectPii({
        texts: input.texts,
        entities: presidioEntitiesFor(input.piiRedactionLevel, input.entities),
        signal: controller.signal,
        ...(input.projectId ? { projectId: input.projectId } : {}),
      });
    } catch (error) {
      if (error instanceof LangevalsPiiDetectionError) {
        this.metrics.analysisObserved(performance.now() - startedAt);
        this.metrics.analysisFinished("error");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
