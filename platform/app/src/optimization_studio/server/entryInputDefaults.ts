import type { Entry, Field, NodeDataset, Workflow } from "../types/dsl";

type Inline = NonNullable<NodeDataset["inline"]>;

/**
 * Fills entry-input defaults into a materialized inline dataset.
 *
 * An entry field can carry a default `value`. When the incoming data does not
 * provide that field (its column is absent, or a cell is null/undefined), the
 * default fills it so downstream nodes always receive a value. Provided values
 * always win, and an explicit empty string is left as-is. Returns a new inline
 * (the input is not mutated); a no-op when no field carries a default.
 */
export function entryInlineWithDefaults(
  inline: Inline,
  outputs: Field[],
): Inline {
  const defaults = outputs.filter(
    (field) =>
      field.value !== undefined && field.value !== null && field.value !== "",
  );
  if (defaults.length === 0) return inline;

  const rowCount = Math.max(
    1,
    ...Object.values(inline.records).map((column) => column.length),
  );
  const records = { ...inline.records };
  const columnTypes = [...inline.columnTypes];

  for (const field of defaults) {
    const column = records[field.identifier];
    if (!column) {
      records[field.identifier] = Array.from(
        { length: rowCount },
        () => field.value,
      );
      if (!columnTypes.some((c) => c.name === field.identifier)) {
        columnTypes.push({ name: field.identifier, type: "string" as const });
      }
    } else {
      records[field.identifier] = column.map((value) =>
        value === null || value === undefined ? field.value : value,
      );
    }
  }

  return { ...inline, records, columnTypes };
}

/**
 * Applies entry-input defaults to a workflow's entry node, returning a new
 * workflow. A no-op when there is no entry node, no inline dataset, or no
 * entry field carries a default. Run after the inline dataset is materialized
 * (loadDatasets) and after API parameters are injected.
 */
export function applyEntryInputDefaults(workflow: Workflow): Workflow {
  let changed = false;
  const nodes = workflow.nodes.map((node) => {
    if (node.type !== "entry") return node;
    const data = node.data as Entry;
    const inline = data.dataset?.inline;
    if (!inline) return node;
    const nextInline = entryInlineWithDefaults(inline, data.outputs ?? []);
    if (nextInline === inline) return node;
    changed = true;
    return {
      ...node,
      data: { ...data, dataset: { ...data.dataset, inline: nextInline } },
    };
  });
  return changed ? { ...workflow, nodes } : workflow;
}
