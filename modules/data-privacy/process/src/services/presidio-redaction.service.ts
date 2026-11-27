import { LangevalsPiiDetectionError } from "@langwatch/evaluation-contract";
import type { PIIRedactionLevel } from "@langwatch/trace-contract";

import { canSplit, type PresidioChannel } from "../channels/presidio.channel.ts";
import {
  clearingOfAnswer,
  PII_ANALYSIS_TEXT_BUDGET,
  presidioEntitiesFor,
} from "../rules/pii-analysis.rules.ts";
import type {
  PiiAnalysisMethod,
  PiiAnalysisMetricsOtelService,
} from "./pii-analysis-metrics-otel.service.ts";

/** One batch for `clear`, as the redaction pass hands it over. */
type PresidioClearInput = {
  texts: readonly string[];
  piiRedactionLevel: PIIRedactionLevel;
  entities?: readonly string[] | undefined;
  projectId?: string | undefined;
  /** Per text: a model, provider or tool name, spared name and place findings. */
  spareNamesAndPlaces?: readonly boolean[] | undefined;
};

type PresidioRedactionDependencies = {
  presidio: PresidioChannel;
  metrics: Pick<
    PiiAnalysisMetricsOtelService,
    "analysisCalled" | "analysisObserved" | "analysisFinished"
  >;
  timeoutMs: number;
  /** The `method` label each call is counted under, and the evaluator label it is timed under. */
  method: PiiAnalysisMethod;
};

/**
 * A batch through langevals' Presidio, reached directly (R5, 2026-10-06): `clearPresidio`.
 * The PII redaction model answers the same exchange, so it runs through a second instance.
 */
export class PresidioRedactionService {
  static create(
    input: Omit<PresidioRedactionDependencies, "method"> & { method?: PiiAnalysisMethod },
  ): PresidioRedactionService {
    return new PresidioRedactionService({ ...input, method: input.method ?? "presidio" });
  }

  #configured: Promise<boolean> | undefined;

  private constructor(private readonly deps: PresidioRedactionDependencies) {}

  /** Whether its channel takes split calls: the model's Lambda channel does (ADR-207). */
  canSplit(): boolean {
    return canSplit(this.deps.presidio);
  }

  /** Asked once, with an empty batch that sends nothing; a failed answer is asked again. */
  isConfigured(): Promise<boolean> {
    this.#configured ??= this.deps.presidio
      .detect({ texts: [], entities: [], signal: new AbortController().signal })
      .then((outcome) => outcome.kind !== "not_configured")
      .catch((error: unknown) => {
        this.#configured = undefined;
        throw error;
      });
    return this.#configured;
  }

  /** One anonymized text per input, or null where Presidio left it as it was. */
  async clear(input: PresidioClearInput): Promise<(string | null)[]> {
    return (await this.clearCounting(input)).cleared;
  }

  /** As `clear`, plus how many findings the service reported across the batch, for a usage log. */
  async clearCounting(
    input: PresidioClearInput,
  ): Promise<{ cleared: (string | null)[]; findings: number }> {
    if (input.texts.length === 0) return { cleared: [], findings: 0 };

    this.deps.metrics.analysisCalled(this.deps.method);
    const truncated = input.texts.map((text) => ({
      input: text.slice(0, PII_ANALYSIS_TEXT_BUDGET),
      remaining: text.slice(PII_ANALYSIS_TEXT_BUDGET),
    }));
    const startedAt = performance.now();
    const outcome = await this.#detect({ ...input, texts: truncated.map((t) => t.input) });
    this.deps.metrics.analysisObserved(performance.now() - startedAt, this.deps.method);

    if (outcome.kind === "not_configured") {
      throw new Error("LANGEVALS_ENDPOINT is not set, PII check cannot be performed");
    }

    let findings = 0;
    const cleared = truncated.map((entry, i) => {
      const result = outcome.results[i];
      if (!result) throw new Error(`Presidio returned no result for text ${i}`);
      this.deps.metrics.analysisFinished(result.status, this.deps.method);
      if (result.status === "error") throw new Error(result.details);
      if (result.status !== "processed") return null;
      findings += findingsIn(result.raw_response);
      const clearing = clearingOfAnswer({
        input: entry.input,
        rawResponse: result.raw_response,
        spareNamesAndPlaces: input.spareNamesAndPlaces?.[i] ?? false,
      });
      return clearing.kind === "redacted" ? clearing.text + entry.remaining : null;
    });
    return { cleared, findings };
  }

  /**
   * The service's raw answer per piece of a split span (ADR-207): its findings and its own masked
   * text, sent as a split call on the one channel. Aborted by `signal` or at the time cap; any
   * refusal, a missing result or a channel that cannot split throws.
   */
  async answers<Piece>(input: {
    pieces: readonly Piece[];
    textOf: (piece: Piece) => string;
    piiRedactionLevel: PIIRedactionLevel;
    entities?: readonly string[] | undefined;
    projectId?: string | undefined;
    signal: AbortSignal;
  }): Promise<{ piece: Piece; findings: unknown; anonymized: unknown }[]> {
    const channel = this.deps.presidio;
    if (!canSplit(channel)) throw new Error("the model's channel takes no split calls");
    this.deps.metrics.analysisCalled(this.deps.method);
    const startedAt = performance.now();
    const outcome = await this.#detect({
      texts: input.pieces.map(input.textOf),
      piiRedactionLevel: input.piiRedactionLevel,
      entities: input.entities,
      projectId: input.projectId,
      signal: input.signal,
      send: (request) => channel.detect(request, { context: "split" }),
    });
    this.deps.metrics.analysisObserved(performance.now() - startedAt, this.deps.method);
    if (outcome.kind === "not_configured") throw new Error("the model is not configured");
    return input.pieces.map((piece, i) => {
      const result = outcome.results[i];
      if (!result) throw new Error(`the model returned no result for split text ${i}`);
      this.deps.metrics.analysisFinished(result.status, this.deps.method);
      if (result.status === "error") throw new Error(result.details);
      const response =
        result.status === "processed" && typeof result.raw_response === "object"
          ? (result.raw_response ?? {})
          : {};
      return {
        piece,
        // No list is not an empty one: a whole text then keeps the model's own masked text.
        findings: "results" in response ? response.results : undefined,
        anonymized: "anonymized" in response ? response.anonymized : null,
      };
    });
  }

  async #detect(input: {
    texts: readonly string[];
    piiRedactionLevel: PIIRedactionLevel;
    entities?: readonly string[] | undefined;
    projectId?: string | undefined;
    signal?: AbortSignal | undefined;
    send?: PresidioChannel["detect"];
  }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.deps.timeoutMs);
    const outer = input.signal;
    const abort = () => controller.abort();
    if (outer?.aborted) controller.abort();
    outer?.addEventListener("abort", abort, { once: true });
    const startedAt = performance.now();
    try {
      const send = input.send ?? ((request) => this.deps.presidio.detect(request));
      return await send({
        texts: input.texts,
        entities: presidioEntitiesFor(input.piiRedactionLevel, input.entities),
        signal: controller.signal,
        ...(input.projectId ? { projectId: input.projectId } : {}),
      });
    } catch (error) {
      if (error instanceof LangevalsPiiDetectionError) {
        this.deps.metrics.analysisObserved(performance.now() - startedAt, this.deps.method);
        this.deps.metrics.analysisFinished("error", this.deps.method);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      outer?.removeEventListener("abort", abort);
    }
  }
}

/** How many findings one answer lists; their values are never read here. */
function findingsIn(rawResponse: unknown): number {
  if (typeof rawResponse !== "object" || rawResponse === null) return 0;
  const results = "results" in rawResponse ? rawResponse.results : undefined;
  return Array.isArray(results) ? results.length : 0;
}
