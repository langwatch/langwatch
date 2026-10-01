import type { LangWatchQLSchema, LangWatchQLSchemaDataset } from "@langwatch/analytics-contract";

import { LWQL_KEYWORDS } from "./lwql-monarch.ts";

export const LWQL_NAMESPACE = "analytics";

const FROM_TARGET = new RegExp(
  `\\b(?:from|join)\\s+analytics\\.([A-Za-z_]\\w*)` +
    `(?:\\s+(?:as\\s+)?(?!(?:${LWQL_KEYWORDS.join("|")})\\b)([A-Za-z_]\\w*))?`,
  "gi",
);

/** A dataset a statement reads, and the name it is known by in that statement. */
export type LwqlScopeEntry = Readonly<{
  dataset: LangWatchQLSchemaDataset;
  qualifier: string;
}>;

/** The schema's dataset of that name, matched without regard to case. */
export function findDataset({
  schema,
  name,
}: {
  schema: LangWatchQLSchema;
  name: string;
}): LangWatchQLSchemaDataset | undefined {
  const wanted = name.toLowerCase();
  return schema.views.find((view) => view.name.toLowerCase() === wanted);
}

/** Every dataset named after FROM or JOIN in the statement, with its alias. */
export function datasetsInScope({
  schema,
  text,
}: {
  schema: LangWatchQLSchema;
  text: string;
}): LwqlScopeEntry[] {
  const entries: LwqlScopeEntry[] = [];
  for (const match of text.matchAll(FROM_TARGET)) {
    const dataset = findDataset({ schema, name: match[1] ?? "" });
    if (!dataset) continue;
    const alias = match[2];
    const qualifier = alias ?? dataset.name;
    entries.push({ dataset, qualifier });
  }
  return entries;
}
