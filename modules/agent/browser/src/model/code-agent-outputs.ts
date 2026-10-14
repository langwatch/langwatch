import type { Field } from "@langwatch/agent-contract";

/** The output types the code editor offers: the code types, and a JSON schema with its editor. */
export const CODE_OUTPUT_TYPES: readonly Field["type"][] = [
  "str",
  "float",
  "bool",
  "json_schema",
  "dict",
  "list",
  "image",
];

/** One row as the outputs editor reports it. */
export type EditedOutput = { identifier: string; type: Field["type"]; json_schema?: object };

/** The types to offer: the code types, plus any type a stored output already has. */
export function offeredOutputTypes(outputs: readonly Field[]): Field["type"][] {
  const offered = [...CODE_OUTPUT_TYPES];
  for (const { type } of outputs) if (!offered.includes(type)) offered.push(type);
  return offered;
}

/**
 * The outputs after an edit. A row keeps the keys the editor does not show (a description, a
 * default) from the output it was, found by name or, for a rename, by position.
 */
export function outputsFromEditor({
  previous,
  next,
}: {
  previous: readonly Field[];
  next: readonly EditedOutput[];
}): Field[] {
  const byName = new Map(previous.map((field) => [field.identifier, field]));
  const renamed = previous.length === next.length;
  return next.map(({ identifier, type, json_schema }, index) => {
    const { json_schema: _schema, ...kept } =
      byName.get(identifier) ?? (renamed ? previous[index] : void 0) ?? {};
    return {
      ...kept,
      identifier,
      type,
      ...(type === "json_schema" && json_schema ? { json_schema: { ...json_schema } } : {}),
    };
  });
}
