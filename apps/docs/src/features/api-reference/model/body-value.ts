import type { FormField, GroupField, ListField } from "./body-form.ts";
import { bodyFormOf } from "./body-form.ts";
import { initialBodyOf } from "./codegen.ts";
import { scalarInput, scalarValue } from "./field-value.ts";
import type { Operation } from "./operation.ts";

/** What the form's controls hold, by field key, one entry per control (a list has one per row). */
export type FormEntries = Record<string, string[]>;
type Read = { present: boolean; value?: unknown };

function parseJson({ text }: { text: string }): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return { error: `Invalid JSON: ${error instanceof Error ? error.message : "could not parse"}` };
  }
}

function readList({
  field,
  raws,
  errors,
}: {
  field: ListField;
  raws: string[];
  errors: Record<string, string>;
}): Read {
  const values = raws.flatMap((raw) => {
    const read = scalarValue({ field: field.item, raw });
    if (read.error) errors[`body:${field.key}`] = read.error;
    return read.value === void 0 ? [] : [read.value];
  });
  return values.length || field.required ? { present: true, value: values } : { present: false };
}

function readField({
  field,
  entries,
  errors,
  unfilled,
}: {
  field: FormField;
  entries: FormEntries;
  errors: Record<string, string>;
  unfilled: string[];
}): Read {
  const raws = entries[field.key] ?? [];
  if (field.kind === "group") return readGroup({ group: field, entries, errors, unfilled });
  if (field.kind === "list") return readList({ field, raws, errors });
  if (field.kind === "json") {
    const raw = raws[0] ?? "";
    if (!raw.trim()) return { present: false };
    const parsed = parseJson({ text: raw });
    if ("value" in parsed) return { present: true, value: parsed.value };
    errors[`body:${field.key}`] = parsed.error;
    return { present: false };
  }
  const read = scalarValue({ field, raw: raws[0] ?? "" });
  if (read.error) errors[`body:${field.key}`] = read.error;
  return read.value === void 0 ? { present: false } : { present: true, value: read.value };
}

function readGroup({
  group,
  entries,
  errors,
  unfilled = [],
}: {
  group: GroupField;
  entries: FormEntries;
  errors: Record<string, string>;
  unfilled?: string[];
}): Read {
  const value: Record<string, unknown> = {};
  const missing: FormField[] = [];
  for (const field of group.fields) {
    /* A broken value blocks even inside an optional group that is otherwise empty. */
    const read = readField({ field, entries, errors, unfilled });
    if (read.present) value[field.name] = read.value;
    else if (field.required) missing.push(field);
  }
  const present = Object.keys(value).length > 0 || group.required || group.path.length === 0;
  if (!present) return { present: false };
  for (const field of missing) {
    const key = `body:${field.key}`;
    if (errors[key] !== void 0) continue;
    unfilled.push(key);
    errors[key] = `${field.name} is required.`;
  }
  return { present: true, value };
}

/**
 * The body the form holds, as JSON text, with its keys outside the schema kept; empty optional
 * fields are left out, and an optional body with nothing filled in is no body at all.
 */
export function readBodyForm({
  form,
  entries,
  extra = {},
}: {
  form: GroupField;
  entries: FormEntries;
  extra?: Record<string, unknown>;
}): { body: string; errors: Record<string, string>; unfilled: string[] } {
  const errors: Record<string, string> = {};
  const unfilled: string[] = [];
  const read = readGroup({ group: form, entries, errors, unfilled });
  const value = { ...(read.value as Record<string, unknown>), ...extra };
  if (!form.required && Object.keys(value).length === 0) {
    const broken = Object.entries(errors).filter(([key]) => !unfilled.includes(key));
    return { body: "", errors: Object.fromEntries(broken), unfilled: [] };
  }
  return { body: JSON.stringify(value, null, 2), errors, unfilled };
}

function writeList({
  field,
  value,
  entries,
  misfits,
}: {
  field: ListField;
  value: unknown;
  entries: FormEntries;
  misfits: string[];
}) {
  if (value === void 0) {
    entries[field.key] = [];
    return;
  }
  /* An optional list sent empty would vanish from the form's body: keep it in JSON. */
  if (Array.isArray(value) && value.length === 0 && !field.required) {
    misfits.push(field.path.join("."));
    return;
  }
  const rows = Array.isArray(value)
    ? value.map((item) => scalarInput({ field: field.item, value: item }))
    : [null];
  if (rows.some((row) => row === null)) misfits.push(field.path.join("."));
  else entries[field.key] = rows.filter((row) => row !== null);
}

function writeNested({
  field,
  value,
  entries,
  misfits,
}: {
  field: GroupField;
  value: unknown;
  entries: FormEntries;
  misfits: string[];
}) {
  const name = field.path.join(".");
  const emptyOptional = isRecord(value) && Object.keys(value).length === 0 && !field.required;
  if ((value !== void 0 && !isRecord(value)) || emptyOptional) {
    misfits.push(name);
    return;
  }
  const unknown = writeGroup({ group: field, value: value ?? {}, entries, misfits });
  misfits.push(...Object.keys(unknown).map((key) => `${name}.${key}`));
}

function writeField({
  field,
  value,
  entries,
  misfits,
}: {
  field: FormField;
  value: unknown;
  entries: FormEntries;
  misfits: string[];
}) {
  if (field.kind === "group") return writeNested({ field, value, entries, misfits });
  if (field.kind === "list") return writeList({ field, value, entries, misfits });
  if (field.kind === "json") {
    entries[field.key] = [value === void 0 ? "" : JSON.stringify(value, null, 2)];
    return;
  }
  /* An empty string reads back as no value at all, so the form cannot keep it. */
  const input = value === "" ? null : scalarInput({ field, value });
  if (input === null) misfits.push(field.path.join("."));
  else entries[field.key] = [input];
}

function writeGroup({
  group,
  value,
  entries,
  misfits,
}: {
  group: GroupField;
  value: Record<string, unknown>;
  entries: FormEntries;
  misfits: string[];
}) {
  const unknown = { ...value };
  for (const field of group.fields) {
    writeField({ field, value: value[field.name], entries, misfits });
    delete unknown[field.name];
  }
  return unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What each control shows for a JSON body, or why the form cannot show it. Top-level keys the
 * schema does not name ride along unchanged as `extra`.
 */
export function bodyFormEntries({
  form,
  text,
}: {
  form: GroupField;
  text: string;
}):
  | { ok: true; entries: FormEntries; extra: Record<string, unknown> }
  | { ok: false; reason: string } {
  const parsed = text.trim() ? parseJson({ text }) : { value: {} };
  if ("error" in parsed) return { ok: false, reason: parsed.error };
  const { value } = parsed;
  if (!isRecord(value)) return { ok: false, reason: "The form shows a JSON object only." };
  const entries: FormEntries = {};
  const misfits: string[] = [];
  const extra = writeGroup({ group: form, value, entries, misfits });
  if (misfits.length)
    return {
      ok: false,
      reason: `The form cannot show ${misfits.join(", ")}. Edit ${misfits.length > 1 ? "them" : "it"} as JSON.`,
    };
  return { ok: true, entries, extra };
}

export type PlaygroundBody = {
  body: string;
  form: GroupField | null;
  mode: "form" | "json";
  entries: FormEntries;
  extra: Record<string, unknown>;
};

/**
 * Where the playground's body starts. A body the form can show starts from its authored example,
 * else empty, so no placeholder value is sent by accident; any other body keeps the JSON example.
 */
export function playgroundBodyOf({ operation }: { operation: Operation }): PlaygroundBody {
  const form = bodyFormOf({ operation });
  const json = {
    body: initialBodyOf({ operation }),
    form,
    mode: "json" as const,
    entries: {},
    extra: {},
  };
  if (!form) return json;
  const example = operation.body?.contents.find((entry) => entry.type.includes("json"))?.example;
  const seeded = bodyFormEntries({ form, text: example === void 0 ? "" : JSON.stringify(example) });
  if (!seeded.ok) return json;
  const { body } = readBodyForm({ form, entries: seeded.entries, extra: seeded.extra });
  return { body, form, mode: "form", entries: seeded.entries, extra: seeded.extra };
}
