import type { Evaluator } from "@langwatch/evaluator-contract";

type VersionedFields = Pick<Evaluator, "name" | "type" | "config" | "workflowId">;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** Whether a write changed what a version holds; a save that changes nothing writes none. */
export function evaluatorVersionChanged(input: {
  before: VersionedFields;
  after: VersionedFields;
}): boolean {
  const { before, after } = input;
  return (
    before.name !== after.name ||
    before.type !== after.type ||
    before.workflowId !== after.workflowId ||
    JSON.stringify(canonical(before.config)) !== JSON.stringify(canonical(after.config))
  );
}
