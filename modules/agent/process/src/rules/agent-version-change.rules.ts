type VersionedFields = {
  name: string;
  type: string;
  config: unknown;
  workflowId: string | null;
};

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

/** Whether a write changed what the latest version holds; an unchanged write appends none. */
export function agentVersionChanged(input: {
  latest: VersionedFields | null;
  after: VersionedFields;
}): boolean {
  const { latest, after } = input;
  if (!latest) return true;
  return (
    latest.name !== after.name ||
    latest.type !== after.type ||
    latest.workflowId !== after.workflowId ||
    JSON.stringify(canonical(latest.config)) !== JSON.stringify(canonical(after.config))
  );
}
