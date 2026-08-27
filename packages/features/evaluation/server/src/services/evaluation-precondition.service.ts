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
    switch (field) {
      case "input":
        return data.input;
      case "output":
        return data.output;
      case "traces.origin":
        return data.origin;
      case "traces.error":
        return data.hasError ? "true" : "false";
      case "metadata.user_id":
        return data.userId;
      case "metadata.thread_id":
        return data.threadId;
      case "metadata.customer_id":
        return data.customerId;
      case "metadata.labels":
        return data.labels;
      case "metadata.prompt_ids":
        return data.promptIds;
      case "metadata.value": {
        if (!key) {
          return null;
        }

        const decoded = key.replaceAll("·", ".");
        const metadataKey = decoded.replace(/^(langwatch\.)?metadata\./u, "");

        return data.customMetadata?.[metadataKey] ?? null;
      }
      case "spans.type":
        return data.spanTypes;
      case "spans.model":
        return data.spanModels;
      case "topics.topics":
        return data.topicId ? [data.topicId] : null;
      case "topics.subtopics":
        return data.subTopicId ? [data.subTopicId] : null;
      case "events.event_type":
        return data.events?.map((event) => event.eventType) ?? null;
      case "events.metrics.key": {
        const event = data.events?.find((candidate) => candidate.eventType === key);

        return event?.metrics.map((metric) => metric.key) ?? null;
      }
      case "events.event_details.key": {
        const event = data.events?.find((candidate) => candidate.eventType === key);

        return event?.details.map((detail) => detail.key) ?? null;
      }
      default:
        return null;
    }
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
