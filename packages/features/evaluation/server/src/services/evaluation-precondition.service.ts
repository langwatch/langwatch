import type { ExecuteEvaluationCommandData } from "@langwatch/evaluation-contract";
import { getEvaluatorDefinitions } from "@langwatch/evaluator-contract";
import type { EvaluationTraceEvent, EvaluationTraceSpan } from "@langwatch/trace-contract";
import safe from "safe-regex2";
import { z } from "zod";

const preconditionSchema = z
  .object({
    field: z.string().min(1),
    rule: z.enum(["contains", "not_contains", "matches_regex", "is"]),
    value: z.string().min(1).max(500),
    key: z.string().optional(),
    subkey: z.string().optional(),
  })
  .strict();

const preconditionsSchema = z.array(preconditionSchema);

type PreconditionTraceData = {
  input: string | null;
  output: string | null;
  origin: string;
  hasError: boolean;
  userId: string | null;
  threadId: string | null;
  customerId: string | null;
  labels: string[] | null;
  promptIds: string[] | null;
  topicId: string | null;
  subTopicId: string | null;
  spanTypes: string[];
  spanModels: string[];
  customMetadata: Record<string, string> | null;
  events: EvaluationTraceEvent[] | null;
};

type ResolvedValue = string | string[] | null;

/**
 * Every precondition field this service can answer, and how.
 *
 * A table rather than a switch so the vocabulary reads as a list. That matters
 * because there is a SECOND implementation of these rules —
 * `platform/app/src/server/filters/precondition-matchers.ts`, which the monitor
 * sample preview uses — and it knows thirteen fields this one does not:
 * the nine `evaluations.*`, `traces.name`, `metadata.key` and
 * `events.metrics.value`. A precondition on any of those matches traces in the
 * preview and then never fires, because an unknown field resolves to null here
 * and `matches` reads null as "not met". See
 * dev/docs/plans/feature-cleanup/evaluation-precondition-divergence.md.
 */
const FIELD_RESOLVERS: Record<
  string,
  (data: PreconditionTraceData, key: string | undefined) => ResolvedValue
> = {
  input: (data) => data.input,
  output: (data) => data.output,
  "traces.origin": (data) => data.origin,
  "traces.error": (data) => (data.hasError ? "true" : "false"),
  "metadata.user_id": (data) => data.userId,
  "metadata.thread_id": (data) => data.threadId,
  "metadata.customer_id": (data) => data.customerId,
  "metadata.labels": (data) => data.labels,
  "metadata.prompt_ids": (data) => data.promptIds,
  "metadata.value": (data, key) => {
    if (!key) return null;
    // The UI encodes a dotted metadata key with a middle dot so the field
    // string stays parseable, and prefixes it the way the trace stores it.
    const decoded = key.replaceAll("\u00b7", ".");
    const metadataKey = decoded.replace(/^(langwatch\.)?metadata\./u, "");
    return data.customMetadata?.[metadataKey] ?? null;
  },
  "spans.type": (data) => data.spanTypes,
  "spans.model": (data) => data.spanModels,
  "topics.topics": (data) => (data.topicId ? [data.topicId] : null),
  "topics.subtopics": (data) => (data.subTopicId ? [data.subTopicId] : null),
  "events.event_type": (data) => data.events?.map((event) => event.eventType) ?? null,
  "events.metrics.key": (data, key) =>
    data.events?.find((candidate) => candidate.eventType === key)?.metrics.map((m) => m.key) ??
    null,
  "events.event_details.key": (data, key) =>
    data.events?.find((candidate) => candidate.eventType === key)?.details.map((d) => d.key) ??
    null,
};

/** The fields above, for the suite that pins them against the preview's set. */
export const PRECONDITION_FIELDS = Object.keys(FIELD_RESOLVERS);

export class EvaluationPreconditionService {
  static create(): EvaluationPreconditionService {
    return new EvaluationPreconditionService();
  }

  private constructor() {}

  requiredFieldsArePresent(input: {
    evaluatorType: string;
    spans: EvaluationTraceSpan[];
  }): boolean {
    const evaluator = getEvaluatorDefinitions(input.evaluatorType);

    return (
      !evaluator?.requiredFields.includes("contexts") ||
      input.spans.some((span) => span.type === "rag" && span.ragContextTexts.length > 0)
    );
  }

  needEvents(preconditions: unknown): boolean {
    const parsed = preconditionsSchema.safeParse(preconditions);

    return (
      parsed.success && parsed.data.some((precondition) => precondition.field.startsWith("events."))
    );
  }

  areMet(input: {
    data: ExecuteEvaluationCommandData;
    preconditions: unknown;
    spans: EvaluationTraceSpan[];
    events: EvaluationTraceEvent[] | null;
  }): boolean {
    const parsed = preconditionsSchema.safeParse(input.preconditions);
    if (!parsed.success) {
      return true;
    }

    const traceData = this.traceData(input);

    return parsed.data.every((precondition) =>
      this.matches(
        this.fieldValue(precondition.field, traceData, precondition.key),
        precondition.rule,
        precondition.value,
      ),
    );
  }

  private traceData(input: {
    data: ExecuteEvaluationCommandData;
    spans: EvaluationTraceSpan[];
    events: EvaluationTraceEvent[] | null;
  }): PreconditionTraceData {
    return {
      input: input.data.computedInput ?? null,
      output: input.data.computedOutput ?? null,
      origin: input.data.origin ?? "application",
      hasError: input.data.hasError ?? false,
      userId: input.data.userId ?? null,
      threadId: input.data.threadId ?? null,
      customerId: input.data.customerId ?? null,
      labels: input.data.labels ?? null,
      promptIds: input.data.promptIds ?? null,
      topicId: input.data.topicId ?? null,
      subTopicId: input.data.subTopicId ?? null,
      customMetadata: input.data.customMetadata ?? null,
      spanTypes: input.data.spanTypes ?? input.spans.map((span) => span.type),
      spanModels:
        input.data.spanModels ?? input.spans.flatMap((span) => (span.model ? [span.model] : [])),
      events: input.events,
    };
  }

  private fieldValue(
    field: string,
    data: PreconditionTraceData,
    key: string | undefined,
  ): ResolvedValue {
    return FIELD_RESOLVERS[field]?.(data, key) ?? null;
  }

  private matches(
    value: ResolvedValue,
    rule: z.infer<typeof preconditionSchema>["rule"],
    condition: string,
  ): boolean {
    if (rule === "not_contains") {
      if (value === null) {
        return true;
      }

      const values = Array.isArray(value) ? value : [value];

      return !values.some((item) => item.toLowerCase().includes(condition.toLowerCase()));
    }

    if (value === null) {
      return false;
    }

    const values = Array.isArray(value) ? value : [value];
    if (rule === "is") {
      return values.some((item) => item.toLowerCase() === condition.toLowerCase());
    }

    if (rule === "contains") {
      return values.some((item) => item.toLowerCase().includes(condition.toLowerCase()));
    }

    if (!safe(condition)) {
      return false;
    }

    try {
      return new RegExp(condition, "gi").test(Array.isArray(value) ? JSON.stringify(value) : value);
    } catch {
      return false;
    }
  }
}
