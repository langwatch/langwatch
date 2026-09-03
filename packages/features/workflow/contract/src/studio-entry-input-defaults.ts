import type { Entry, Field, NodeDataset, StudioWorkflow } from "./studio-workflow";

type Inline = NonNullable<NodeDataset["inline"]>;

/** Materializes declared entry defaults without mutating the persisted graph. */
export function entryInlineWithDefaults(inline: Inline, outputs: Field[]): Inline {
  const defaults = outputs.filter(
    (field) => field.value !== void 0 && field.value !== null && field.value !== "",
  );
  if (defaults.length === 0) return inline;

  const rowCount = Math.max(1, ...Object.values(inline.records).map((column) => column.length));
  const records = { ...inline.records };
  const columnTypes = [...inline.columnTypes];

  for (const field of defaults) {
    const column = records[field.identifier];
    if (!column) {
      records[field.identifier] = Array.from({ length: rowCount }, () => field.value);
      if (!columnTypes.some((candidate) => candidate.name === field.identifier)) {
        columnTypes.push({ name: field.identifier, type: "string" });
      }
    } else {
      records[field.identifier] = column.map((value) =>
        value === null || value === void 0 ? field.value : value,
      );
    }
  }

  return { ...inline, records, columnTypes };
}

/** Applies entry defaults after an inline dataset has been materialized. */
export function applyEntryInputDefaults(workflow: StudioWorkflow): StudioWorkflow {
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
