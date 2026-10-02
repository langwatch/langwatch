import type {
  LangWatchQLSchema,
  LangWatchQLSchemaAppFunction,
  LangWatchQLSchemaColumn,
  LangWatchQLSchemaDataset,
} from "@langwatch/analytics-contract";

import { LWQL_KEYWORDS } from "./lwql-monarch.ts";
import { datasetsInScope, LWQL_NAMESPACE } from "./lwql-scope.ts";

export type LwqlCompletionKind =
  | "keyword"
  | "function"
  | "table"
  | "column"
  | "parameter"
  | "snippet";

/** A bound parameter the host offers: `{name:Type}`. Reserved ones bind themselves. */
export type LwqlParameter = Readonly<{
  name: string;
  type?: string;
  description?: string;
  reserved?: boolean;
}>;

export type LwqlCompletionItem = Readonly<{
  label: string;
  kind: LwqlCompletionKind;
  insertText: string;
  isSnippet: boolean;
  detail?: string;
  documentation?: string;
  sortText: string;
  /** Shown but never inserted: the member's grants do not unlock it. */
  disabled: boolean;
}>;

export type LwqlCompletions = Readonly<{
  /** Offset the suggestions replace from, up to the cursor. */
  replaceFrom: number;
  items: readonly LwqlCompletionItem[];
}>;

const IDENTIFIER_TAIL = /[A-Za-z_]\w*$/;
const QUALIFIER_TAIL = /([A-Za-z_]\w*)\.$/;
const PARAMETER_TAIL = /\{\w*$/;
const RELATION_POSITION = /\b(?:from|join)\s+$/i;
const COMPLETE_SPAN = /'(?:[^'\\]|\\.|'')*'|\/\*[\s\S]*?\*\/|--[^\n]*\n/g;
const OPEN_SPAN = /'|\/\*|--/;

/** Sort groups keep the schema's own order inside each kind. */
function sortKey({ group, index }: { group: string; index: number }): string {
  return `${group}${String(index).padStart(4, "0")}`;
}

function insideStringOrComment(before: string): boolean {
  return OPEN_SPAN.test(before.replace(COMPLETE_SPAN, " "));
}

function withheldDetail({ type, gates }: { type: string; gates: readonly string[] }): string {
  return `${type} · needs ${gates.length > 0 ? gates.join(", ") : "more access"}`;
}

function columnItem({
  column,
  index,
  prefix,
}: {
  column: LangWatchQLSchemaColumn;
  index: number;
  prefix: string;
}): LwqlCompletionItem {
  const unit = column.unit ? ` (${column.unit})` : "";
  return {
    label: column.name,
    kind: "column",
    insertText: column.available ? column.name : prefix,
    isSnippet: false,
    detail: column.available
      ? `${column.type}${unit}`
      : withheldDetail({ type: column.type, gates: column.gates }),
    documentation: column.description,
    sortText: sortKey({ group: column.available ? "1" : "9", index }),
    disabled: !column.available,
  };
}

function datasetItems({
  datasets,
  qualified,
}: {
  datasets: readonly LangWatchQLSchemaDataset[];
  qualified: boolean;
}): LwqlCompletionItem[] {
  return datasets.map((dataset, index) => ({
    label: qualified ? `${LWQL_NAMESPACE}.${dataset.name}` : dataset.name,
    kind: "table",
    insertText: qualified ? `${LWQL_NAMESPACE}.${dataset.name}` : dataset.name,
    isSnippet: false,
    detail: dataset.grain,
    documentation: dataset.description,
    sortText: sortKey({ group: "0", index }),
    disabled: false,
  }));
}

/** `f(a, b)` becomes `f(${1:a}, ${2:b})` so Tab walks the arguments. */
function appFunctionSnippet(fn: LangWatchQLSchemaAppFunction): string {
  const inner = /\((.*)\)/.exec(fn.signature)?.[1] ?? "";
  const args = inner
    .split(",")
    .map((arg) => arg.trim())
    .filter((arg) => arg.length > 0)
    .map((arg, i) => `\${${i + 1}:${arg}}`);
  return `${fn.name}(${args.join(", ")})`;
}

function functionItems({
  schema,
  prefix,
}: {
  schema: LangWatchQLSchema;
  prefix: string;
}): LwqlCompletionItem[] {
  const appNames = new Set(schema.appFunctions.map((fn) => fn.name));
  const plain = schema.functions
    .filter((name) => !appNames.has(name))
    .map((name, index): LwqlCompletionItem => ({
      label: name,
      kind: "function",
      insertText: `${name}($0)`,
      isSnippet: true,
      detail: "function",
      sortText: sortKey({ group: "3", index }),
      disabled: false,
    }));
  const app = schema.appFunctions.map((fn, index): LwqlCompletionItem => ({
    label: fn.name,
    kind: "snippet",
    insertText: fn.available ? appFunctionSnippet(fn) : prefix,
    isSnippet: fn.available,
    detail: fn.available ? fn.signature : withheldDetail({ type: fn.returns, gates: fn.gates }),
    documentation: fn.description,
    sortText: sortKey({ group: fn.available ? "2" : "9", index }),
    disabled: !fn.available,
  }));
  return [...app, ...plain];
}

function keywordItems(): LwqlCompletionItem[] {
  return LWQL_KEYWORDS.map((keyword, index) => ({
    label: keyword.toUpperCase(),
    kind: "keyword",
    insertText: keyword.toUpperCase(),
    isSnippet: false,
    sortText: sortKey({ group: "5", index }),
    disabled: false,
  }));
}

function parameterItems(parameters: readonly LwqlParameter[]): LwqlCompletionItem[] {
  return parameters.map((parameter, index) => ({
    label: parameter.name,
    kind: "parameter",
    insertText: parameter.type
      ? `{${parameter.name}:${parameter.type}}`
      : `{${parameter.name}:\${1:Type}}`,
    isSnippet: !parameter.type,
    detail: parameter.reserved
      ? `${parameter.type ?? "parameter"} · bound for you`
      : parameter.type,
    documentation: parameter.description,
    sortText: sortKey({ group: parameter.reserved ? "0" : "1", index }),
    disabled: false,
  }));
}

function columnItems({
  schema,
  text,
  qualifier,
  prefix,
}: {
  schema: LangWatchQLSchema;
  text: string;
  qualifier: string | undefined;
  prefix: string;
}): LwqlCompletionItem[] {
  const wanted = qualifier?.toLowerCase();
  return datasetsInScope({ schema, text })
    .filter((entry) => wanted === undefined || entry.qualifier.toLowerCase() === wanted)
    .flatMap((entry) =>
      entry.dataset.columns.map((column, index) => columnItem({ column, index, prefix })),
    );
}

/**
 * What to offer at the cursor, from the live schema alone. Without a schema only
 * keywords are offered, which is what keeps the editor usable when the read fails.
 */
export function lwqlCompletions({
  schema,
  text,
  offset,
  parameters = [],
}: {
  schema: LangWatchQLSchema | undefined;
  text: string;
  offset: number;
  parameters?: readonly LwqlParameter[];
}): LwqlCompletions {
  const before = text.slice(0, offset);
  if (insideStringOrComment(before)) return { replaceFrom: offset, items: [] };

  const brace = PARAMETER_TAIL.exec(before);
  if (brace) return { replaceFrom: brace.index, items: parameterItems(parameters) };

  const prefix = IDENTIFIER_TAIL.exec(before)?.[0] ?? "";
  const replaceFrom = offset - prefix.length;
  if (!schema) return { replaceFrom, items: keywordItems() };

  const head = before.slice(0, replaceFrom);
  const qualifier = QUALIFIER_TAIL.exec(head)?.[1];
  if (qualifier?.toLowerCase() === LWQL_NAMESPACE) {
    return { replaceFrom, items: datasetItems({ datasets: schema.views, qualified: false }) };
  }
  if (qualifier) {
    return { replaceFrom, items: columnItems({ schema, text, qualifier, prefix }) };
  }
  if (RELATION_POSITION.test(head)) {
    return { replaceFrom, items: datasetItems({ datasets: schema.views, qualified: true }) };
  }
  return {
    replaceFrom,
    items: [
      ...columnItems({ schema, text, qualifier: undefined, prefix }),
      ...functionItems({ schema, prefix }),
      ...keywordItems(),
    ],
  };
}
