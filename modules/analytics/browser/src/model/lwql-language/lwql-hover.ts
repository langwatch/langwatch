import type { LangWatchQLSchema } from "@langwatch/analytics-contract";

import { datasetsInScope, findDataset, LWQL_NAMESPACE, type LwqlScopeEntry } from "./lwql-scope.ts";

export type LwqlHover = Readonly<{
  /** Markdown paragraphs, first is the heading line. */
  contents: readonly string[];
  start: number;
  end: number;
}>;

const WORD = /[A-Za-z_]\w*/g;

function wordAt({ text, offset }: { text: string; offset: number }) {
  for (const match of text.matchAll(WORD)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (offset >= start && offset <= end) return { word: match[0], start, end };
  }
  return undefined;
}

function paragraphs(...parts: (string | false | null | undefined)[]): string[] {
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0);
}

type Located = Readonly<{ start: number; end: number }>;

function columnHover({
  entries,
  lower,
  located,
}: {
  entries: readonly LwqlScopeEntry[];
  lower: string;
  located: Located;
}): LwqlHover | undefined {
  const column = entries
    .flatMap((entry) => entry.dataset.columns)
    .find((c) => c.name.toLowerCase() === lower);
  if (!column) return undefined;
  return {
    ...located,
    contents: paragraphs(
      `**${column.name}** · \`${column.type}\`${column.unit ? ` (${column.unit})` : ""}`,
      column.description,
      !column.available && `Needs ${column.gates.join(", ") || "more access"}.`,
    ),
  };
}

function functionHover({
  schema,
  word,
  located,
}: {
  schema: LangWatchQLSchema;
  word: string;
  located: Located;
}): LwqlHover | undefined {
  const lower = word.toLowerCase();
  const app = schema.appFunctions.find((fn) => fn.name.toLowerCase() === lower);
  if (app) {
    return {
      ...located,
      contents: paragraphs(
        `**${app.signature}** · \`${app.returns}\``,
        app.description,
        !app.available && `Needs ${app.gates.join(", ") || "more access"}.`,
      ),
    };
  }
  if (!schema.functions.some((name) => name.toLowerCase() === lower)) return undefined;
  return { ...located, contents: [`**${word}** · function`] };
}

function datasetHover({
  schema,
  word,
  located,
}: {
  schema: LangWatchQLSchema;
  word: string;
  located: Located;
}): LwqlHover | undefined {
  const dataset = findDataset({ schema, name: word });
  if (!dataset) return undefined;
  return {
    ...located,
    contents: paragraphs(
      `**${LWQL_NAMESPACE}.${dataset.name}** · ${dataset.grain}`,
      dataset.description,
      dataset.timeColumn && `Time column: \`${dataset.timeColumn}\``,
      dataset.freshness && `Freshness: ${dataset.freshness}`,
      dataset.joinKeys.length > 0 && `Join keys: ${dataset.joinKeys.join(", ")}`,
    ),
  };
}

/** Hover docs for the identifier under the cursor, from the schema's own descriptions. */
export function lwqlHoverAt({
  schema,
  text,
  offset,
}: {
  schema: LangWatchQLSchema | undefined;
  text: string;
  offset: number;
}): LwqlHover | undefined {
  const found = schema && wordAt({ text, offset });
  if (!schema || !found) return undefined;
  const located = { start: found.start, end: found.end };
  const qualifier = /([A-Za-z_]\w*)\.$/.exec(text.slice(0, found.start))?.[1]?.toLowerCase();
  if (qualifier === LWQL_NAMESPACE) return datasetHover({ schema, word: found.word, located });
  const entries = datasetsInScope({ schema, text }).filter(
    (entry) => qualifier === undefined || entry.qualifier.toLowerCase() === qualifier,
  );
  return (
    columnHover({ entries, lower: found.word.toLowerCase(), located }) ??
    functionHover({ schema, word: found.word, located })
  );
}
