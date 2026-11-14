/**
 * The braid condition as an editor language: a Monarch grammar giving the same token kinds as the
 * design system's `tokeniseExpression`, and the completions offered at a cursor.
 */

import { BRAID_CONDITION_VOCABULARY } from "@langwatch/authz-contract/braid-condition-compiler";
import type { ExpressionTokenKind } from "@langwatch/design-system/highlighted-expression";
import type { languages } from "monaco-editor";

export const BRAID_CONDITION_LANGUAGE_ID = "braid-condition";

/** The token kinds the grammar emits; plain text takes the theme's default colour. */
export const BRAID_CONDITION_TOKEN_KINDS: readonly Exclude<ExpressionTokenKind, "plain">[] = [
  "keyword",
  "function",
  "field",
  "string",
  "number",
  "operator",
  "punctuation",
];

/** Mirrors `tokeniseExpression`: strings, keywords, a word before `(` a function, else a field. */
export const BRAID_CONDITION_MONARCH: languages.IMonarchLanguage = {
  defaultToken: "",
  tokenizer: {
    root: [
      [/"(?:[^"\\]|\\.)*"?/, "string"],
      [/(?:and|or|not|nil|true|false)(?![A-Za-z0-9_])/, "keyword"],
      [/[A-Za-z_][A-Za-z0-9_]*(?=\s*\()/, "function"],
      [/[A-Za-z_][A-Za-z0-9_]*/, "field"],
      [/-?[0-9][0-9.eE+-]*/, "number"],
      [/==|!=|<=|>=|&&|\|\||<|>|=|!/, "operator"],
      [/[()[\]{}.,]/, "punctuation"],
    ],
  },
};

export type BraidConditionCompletion = {
  label: string;
  kind: "field" | "keyword" | "operator" | "snippet";
  insertText: string;
  /** The text Monaco filters against: what the replaced range holds once typed. */
  filterText: string;
  sortText: string;
  detail?: string;
  isSnippet?: boolean;
  /** Opens the list again after inserting, so `attributes[""]` goes on to offer the keys. */
  retrigger?: boolean;
};

export type BraidConditionCompletions = {
  items: BraidConditionCompletion[];
  /** Offsets of the text an accepted item replaces. */
  replaceFrom: number;
  replaceTo: number;
};

// A key never spans a line break: Monaco drops a list whose range crosses lines.
const ATTRIBUTE_OPEN = /attributes\s*\[\s*(?:"((?:[^"\\\r\n]|\\.)*))?$/;
const KEY_REST = /^(?:[^"\\\]\r\n]|\\.)*/;

const DETAIL: Readonly<Record<string, string>> = {
  attributes: "A span attribute",
  "resource.attributes": "An attribute of the span's resource",
  name: "The span's name",
  Verified: "Calls signed by a project's key",
  nil: "With !=, the attribute is set",
};

const { indexedPaths, paths, functions, operators, words } = BRAID_CONDITION_VOCABULARY;

/** The compiler's vocabulary as completions, so the list never offers a refused construct. */
const TOP_LEVEL: readonly Omit<BraidConditionCompletion, "sortText" | "filterText">[] = [
  ...indexedPaths.map((path) => ({
    label: `${path}[""]`,
    kind: "snippet" as const,
    insertText: `${path}["$0"]`,
    isSnippet: true,
    retrigger: true,
    detail: DETAIL[path],
  })),
  ...paths.map((path) => ({
    label: path,
    kind: "field" as const,
    insertText: path,
    detail: DETAIL[path],
  })),
  ...functions.map((name) => ({
    label: `${name}("")`,
    kind: "snippet" as const,
    insertText: `${name}("$0")`,
    isSnippet: true,
    detail: DETAIL[name],
  })),
  ...operators.map((operator) => ({
    label: operator,
    kind: "operator" as const,
    insertText: operator,
  })),
  ...words.map((word) => ({
    label: word,
    kind: "keyword" as const,
    insertText: word,
    detail: DETAIL[word],
  })),
];

const sortTextOf = (index: number) => String(index).padStart(4, "0");

/** Whether `before` ends inside an unclosed double-quoted string. */
function insideString(before: string): boolean {
  let open = false;
  for (let index = 0; index < before.length; index++) {
    if (open && before[index] === "\\") index++;
    else if (before[index] === '"') open = !open;
  }
  return open;
}

function attributeKeyCompletions({
  text,
  offset,
  quoted,
  typed,
  attributeKeys,
}: {
  text: string;
  offset: number;
  quoted: boolean;
  typed: string;
  attributeKeys: readonly { key: string; spanCount: number }[];
}): BraidConditionCompletions {
  let rest = text.slice(offset);
  let replaceTo = offset;
  const take = (length: number) => {
    replaceTo += length;
    rest = rest.slice(length);
  };
  if (!quoted && rest.startsWith('"')) take(1);
  if (quoted || replaceTo > offset) take(KEY_REST.exec(rest)?.[0].length ?? 0);
  if (rest.startsWith('"')) take(1);
  if (rest.startsWith("]")) take(1);
  const replaceFrom = quoted ? offset - typed.length - 1 : offset;
  const items = attributeKeys
    .toSorted((a, b) => b.spanCount - a.spanCount || a.key.localeCompare(b.key))
    .map(({ key, spanCount }, index) => ({
      label: key,
      kind: "field" as const,
      insertText: `"${key.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"]`,
      filterText: quoted ? `"${key}` : key,
      sortText: sortTextOf(index),
      detail: `${spanCount.toLocaleString("en-GB")} ${spanCount === 1 ? "span" : "spans"}`,
    }));
  return { items, replaceFrom, replaceTo };
}

/** What to offer at `offset`: the owner's keys inside `attributes[`, the grammar elsewhere. */
export function braidConditionCompletions({
  text,
  offset,
  attributeKeys,
}: {
  text: string;
  offset: number;
  attributeKeys: readonly { key: string; spanCount: number }[];
}): BraidConditionCompletions {
  const before = text.slice(0, offset);
  const attribute = ATTRIBUTE_OPEN.exec(before);
  if (attribute) {
    const typed = attribute[1];
    return attributeKeyCompletions({
      text,
      offset,
      quoted: typed !== undefined,
      typed: typed ?? "",
      attributeKeys,
    });
  }
  if (insideString(before)) return { items: [], replaceFrom: offset, replaceTo: offset };
  const typed = /[A-Za-z_=!]*$/.exec(before)?.[0] ?? "";
  const replaceFrom = offset - typed.length;
  const items = TOP_LEVEL.map((item, index) => ({
    ...item,
    filterText: item.label,
    sortText: sortTextOf(index),
  }));
  return { items, replaceFrom, replaceTo: offset };
}
