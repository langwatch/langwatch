import { mergeExampleSchema } from "./codegen.ts";
import type { Operation, Schema } from "./operation.ts";

/** Controls a value of one plain type maps to. */
export type ScalarKind =
  | "text"
  | "date"
  | "date-time"
  | "epoch-ms"
  | "enum"
  | "boolean"
  | "number"
  | "integer";

type FieldBase = {
  name: string;
  path: string[];
  /** The DOM id suffix and error key: `pg-body-<key>`, `body:<key>`. */
  key: string;
  required: boolean;
  deprecated: boolean;
  description: string;
  /** The type as the reader sees it beside the name. */
  typeLabel: string;
};
export type ScalarField = FieldBase & {
  kind: ScalarKind;
  options: unknown[];
  min?: number;
  max?: number;
  /** A text field whose schema also takes a number sends digits as a number. */
  numeric: boolean;
  defaultValue?: unknown;
};
export type ListField = FieldBase & { kind: "list"; item: ScalarField };
export type GroupField = FieldBase & { kind: "group"; fields: FormField[] };
export type JsonField = FieldBase & { kind: "json" };
export type FormField = ScalarField | ListField | GroupField | JsonField;

const MAX_DEPTH = 3;
const EPOCH_MS =
  /\b(?:unix|epoch)\b[^.]*\b(?:ms|milliseconds)\b|\bmilliseconds since\b[^.]*\bepoch\b/i;
const ISO_DATE = /\bISO[ -]?8601\b/;

export function isScalar(field: FormField): field is ScalarField {
  return field.kind !== "list" && field.kind !== "group" && field.kind !== "json";
}

/** Merges `allOf` and drops a `null` branch, so `anyOf: [X, null]` reads as X. */
function plain(schema: Schema): Schema {
  const merged = mergeExampleSchema({ schema });
  const union = merged.anyOf ?? merged.oneOf;
  if (!union) return merged;
  const kept = union.filter((branch) => branch.type !== "null");
  const scalarOnly = kept.every(
    (branch) => typeof branch.type === "string" && Object.keys(branch).length <= 2,
  );
  if (kept.length > 1 && scalarOnly) {
    const { anyOf: _any, oneOf: _one, ...rest } = merged;
    return { ...rest, type: kept.map((branch) => String(branch.type)) };
  }
  if (kept.length !== 1 || !kept[0]) return merged;
  const { anyOf: _any, oneOf: _one, ...rest } = merged;
  return plain({ ...rest, ...kept[0], description: merged.description ?? kept[0].description });
}

function typesOf(schema: Schema): string[] {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type ?? "null"];
  return types.filter((type) => type !== "null");
}

/** The date control a schema asks for; only its format or description decides, never its name. */
export function dateKindOf({
  schema,
}: {
  schema: Schema;
}): "date" | "date-time" | "epoch-ms" | null {
  const types = typesOf(schema);
  const description = schema.description ?? "";
  if (types.includes("string") && schema.format === "date-time") return "date-time";
  if (types.includes("string") && schema.format === "date") return "date";
  if (types.length === 1 && types[0] === "string" && ISO_DATE.test(description)) return "date-time";
  const numeric = types.some((type) => type === "number" || type === "integer");
  const numericOrText = types.every((type) => ["number", "integer", "string"].includes(type));
  if (numeric && numericOrText && EPOCH_MS.test(description)) return "epoch-ms";
  return null;
}

function keyOf({ path }: { path: string[] }) {
  return path.map((part) => part.replace(/[^A-Za-z0-9_-]/g, "_")).join("--");
}

function scalarKindOf({ schema }: { schema: Schema }): ScalarKind | null {
  const types = typesOf(schema);
  if (schema.enum?.length || schema.const !== void 0) return "enum";
  const date = dateKindOf({ schema });
  if (date) return date;
  if (types.length === 1) {
    const [type] = types;
    if (type === "string") return "text";
    if (type === "boolean") return "boolean";
    if (type === "integer" || type === "number") return type;
    return null;
  }
  if (types.length > 1 && types.every((type) => ["string", "number", "integer"].includes(type)))
    return "text";
  return null;
}

function typeLabelOf({ schema }: { schema: Schema }) {
  const types = typesOf(schema);
  if (!types.length) return schema.properties ? "object" : "JSON";
  const type = types.join(" | ");
  if (type === "array")
    return `array of ${typesOf(plain(schema.items ?? {})).join(" | ") || "values"}`;
  return schema.format ? `${type} · ${schema.format}` : type;
}

/** One form field for a schema, or a JSON field where the form cannot represent it. */
export function fieldOf({
  name,
  schema: raw,
  path,
  required,
  depth = 0,
}: {
  name: string;
  schema: Schema;
  path: string[];
  required: boolean;
  depth?: number;
}): FormField {
  const schema = plain(raw);
  const base: FieldBase = {
    name,
    path,
    key: keyOf({ path }),
    required,
    deprecated: Boolean(schema.deprecated),
    description: schema.description ?? "",
    typeLabel: typeLabelOf({ schema }),
  };
  if (schema.$recursive || schema.anyOf || schema.oneOf) return { ...base, kind: "json" };
  const kind = scalarKindOf({ schema });
  if (kind) return scalarFieldOf({ base, schema, kind });
  return compositeOf({ base, schema, depth });
}

function scalarFieldOf({
  base,
  schema,
  kind,
}: {
  base: FieldBase;
  schema: Schema;
  kind: ScalarKind;
}): ScalarField {
  const constant = schema.const === void 0 ? [] : [schema.const];
  return {
    ...base,
    kind,
    options: schema.enum?.length ? schema.enum : constant,
    min: schema.minimum,
    max: schema.maximum,
    numeric:
      kind === "text" && typesOf(schema).some((type) => type === "number" || type === "integer"),
    defaultValue: schema.default,
  };
}

/** A list of plain values, a group of fields, or JSON for anything deeper or looser. */
function compositeOf({
  base,
  schema,
  depth,
}: {
  base: FieldBase;
  schema: Schema;
  depth: number;
}): FormField {
  const types = typesOf(schema);
  if (types.length === 1 && types[0] === "array") {
    const item = fieldOf({
      name: base.name,
      schema: schema.items ?? {},
      path: base.path,
      required: true,
      depth: depth + 1,
    });
    return isScalar(item) ? { ...base, kind: "list", item } : { ...base, kind: "json" };
  }
  const objectLike = types.length === 0 || (types.length === 1 && types[0] === "object");
  if (!objectLike || depth >= MAX_DEPTH) return { ...base, kind: "json" };
  const fields = Object.entries(schema.properties ?? {}).map(([child, childSchema]) =>
    fieldOf({
      name: child,
      schema: childSchema,
      path: [...base.path, child],
      required: schema.required?.includes(child) ?? false,
      depth: depth + 1,
    }),
  );
  if (fields.some((field) => field.kind !== "json")) return { ...base, kind: "group", fields };
  return { ...base, kind: "json" };
}

/** The JSON body schema as a form, or null when the body is not an object the form can show. */
export function bodyFormOf({ operation }: { operation: Operation }): GroupField | null {
  const content = operation.body?.contents.find((entry) => entry.type.includes("json"));
  if (!content?.schema) return null;
  const root = fieldOf({
    name: "body",
    schema: content.schema,
    path: [],
    required: Boolean(operation.body?.required),
  });
  return root.kind === "group" ? root : null;
}

/** The field a parameter's value is typed by. */
export function paramFieldOf({
  name,
  schema,
  required,
  description,
}: {
  name: string;
  schema: Schema;
  required: boolean;
  description?: string;
}): FormField {
  const described = schema.description || !description ? schema : { ...schema, description };
  return fieldOf({ name, schema: described, path: [name], required });
}
