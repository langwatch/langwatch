import { TraceNotFoundError } from "./errors";
import type {
  FindByTraceIdOptions,
  TraceSummaryRepository,
} from "./repositories/trace-summary.repository";
import type { TraceSummaryData } from "./types";
import { teaserOf } from "./visibility-window.service";

export class TraceSummaryService {
  constructor(readonly repository: TraceSummaryRepository) {}

  async upsert(data: TraceSummaryData, tenantId: string): Promise<void> {
    await this.repository.upsert(data, tenantId);
  }

  async getByTraceId(
    tenantId: string,
    traceId: string,
    options?: FindByTraceIdOptions & {
      /**
       * Read-side visibility gate: summaries that occurred before this
       * cutoff get computed input/output/error teaser-redacted.
       * Omitted/null = ungated (internal callers).
       */
      visibilityCutoffMs?: number | null;
    },
  ): Promise<TraceSummaryData> {
    const result = await this.repository.findByTraceId(
      tenantId,
      traceId,
      options,
    );
    if (!result) throw new TraceNotFoundError(traceId);

    const cutoff = options?.visibilityCutoffMs;
    if (cutoff === null || cutoff === undefined || result.occurredAt >= cutoff) {
      return result;
    }
    return {
      ...result,
      computedInput: result.computedInput
        ? teaserOf(result.computedInput)
        : result.computedInput,
      computedOutput: result.computedOutput
        ? teaserOf(result.computedOutput)
        : result.computedOutput,
      errorMessage: result.errorMessage
        ? teaserOf(result.errorMessage)
        : result.errorMessage,
      redactedByVisibilityWindow: true,
    };
  }
}
