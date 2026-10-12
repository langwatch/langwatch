import type { ExperimentRunWithItems } from "@langwatch/experiment-contract";

/** What a run was tested on, read from the items its results call returned. */
export type TestedOn = {
  /** Distinct items. */
  items: number;
  /** Entry field names, in order of first sight. */
  fields: string[];
  /** Up to three items spread across the set, each field as one line of text. */
  examples: Record<string, string>[];
};

const EXAMPLES = 3;
const MAX_FIELDS = 12;
const MAX_VALUE_CHARS = 160;

function textOf(value: unknown): string {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text;
}

/**
 * Distinct items, the entry fields and three example items from the run's rows. Every target of
 * an item shares its entry, so the first row of each item index stands for it. Undefined when the
 * run carries no items.
 */
export function testedOnOf(run: ExperimentRunWithItems): TestedOn | undefined {
  const entries = new Map<number, Record<string, unknown>>();
  const fields = new Set<string>();
  for (const row of run.dataset) {
    if (entries.has(row.index)) continue;
    entries.set(row.index, row.entry);
    for (const field of Object.keys(row.entry)) fields.add(field);
  }
  if (entries.size === 0) return undefined;
  const indexes = [...entries.keys()].toSorted((a, b) => a - b);
  const count = Math.min(EXAMPLES, indexes.length);
  const examples = Array.from({ length: count }, (_, at) => {
    const index = indexes[Math.floor((indexes.length * (2 * at + 1)) / (2 * count))]!;
    const entry = entries.get(index)!;
    return Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, textOf(value)]));
  }).filter((example) => Object.keys(example).length > 0);
  return { items: entries.size, fields: [...fields].slice(0, MAX_FIELDS), examples };
}
