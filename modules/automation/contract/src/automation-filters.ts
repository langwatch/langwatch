import { z } from "zod";

export const automationFilterFieldSchema = z.enum([
  "topics.topics",
  "topics.subtopics",
  "metadata.user_id",
  "metadata.thread_id",
  "metadata.customer_id",
  "metadata.labels",
  "metadata.key",
  "metadata.value",
  "metadata.prompt_ids",
  "traces.origin",
  "traces.error",
  "traces.name",
  "spans.type",
  "spans.model",
  "evaluations.evaluator_id",
  "evaluations.evaluator_id.guardrails_only",
  "evaluations.evaluator_id.has_passed",
  "evaluations.evaluator_id.has_score",
  "evaluations.evaluator_id.has_label",
  "evaluations.passed",
  "evaluations.score",
  "evaluations.state",
  "evaluations.label",
  "events.event_type",
  "events.metrics.key",
  "events.metrics.value",
  "events.event_details.key",
  "annotations.hasAnnotation",
]);

export const automationFilterValueSchema = z.union([
  z.array(z.string()),
  z.record(z.string(), z.array(z.string())),
  z.record(z.string(), z.record(z.string(), z.array(z.string()))),
]);

export const automationFiltersSchema = z.partialRecord(
  automationFilterFieldSchema,
  automationFilterValueSchema,
);

const permissiveAutomationFiltersSchema = z.record(z.string(), automationFilterValueSchema);

const automationFiltersWireSchema = z.union([permissiveAutomationFiltersSchema, z.string()]);

export type AutomationFilterField = z.infer<typeof automationFilterFieldSchema>;
export type AutomationFilterValue = z.infer<typeof automationFilterValueSchema>;
export type AutomationFilters = z.infer<typeof automationFiltersSchema>;

export function parseAutomationFiltersWire(value: unknown): AutomationFilters {
  const wire = automationFiltersWireSchema.safeParse(value);
  if (!wire.success) {
    return {};
  }

  const canonical = permissiveAutomationFiltersSchema.safeParse(wire.data);
  if (canonical.success) {
    return sanitizeAutomationFilters(canonical.data);
  }

  const candidate = z.string().parse(wire.data);

  let decoded: unknown;
  try {
    decoded = JSON.parse(candidate);
  } catch {
    return {};
  }

  const parsed = permissiveAutomationFiltersSchema.safeParse(decoded);
  return parsed.success ? sanitizeAutomationFilters(parsed.data) : {};
}

export function sanitizeAutomationFilters(
  filters: Readonly<Partial<Record<string, AutomationFilterValue>>>,
): AutomationFilters {
  const parsed = automationFiltersSchema.safeParse(filters);
  if (parsed.success) {
    return parsed.data;
  }

  const sanitized: AutomationFilters = {};
  for (const [field, value] of Object.entries(filters)) {
    if (value === void 0) {
      continue;
    }

    const entry = automationFiltersSchema.safeParse({ [field]: value });
    if (entry.success) {
      Object.assign(sanitized, entry.data);
    }
  }

  return sanitized;
}
