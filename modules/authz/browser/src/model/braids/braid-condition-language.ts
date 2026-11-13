/**
 * The braid condition as an editor language: a Monarch grammar giving the same token kinds as the
 * design system's `tokeniseExpression`, and the completions offered at a cursor.
 */

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

const ATTRIBUTE_OPEN = /attributes\s*\[\s*(?:"((?:[^"\\]|\\.)*))?$/;
const KEY_REST = /^(?:[^"\\\]]|\\.)*/;

const TOP_LEVEL: readonly Omit<BraidConditionCompletion, "sortText" | "filterText">[] = [
  {
    label: 'attributes[""]',
    kind: "snippet",
    insertText: 'attributes["$0"]',
    isSnippet: true,
    retrigger: true,
    detail: "A span attribute",
  },
  {
    label: 'Verified("")',
    kind: "snippet",
    insertText: 'Verified("$0")',
    isSnippet: true,
    detail: "Calls signed by a project's key",
  },
  { label: "==", kind: "operator", insertText: "==" },
  { label: "!=", kind: "operator", insertText: "!=" },
  { label: "and", kind: "keyword", insertText: "and" },
  { label: "or", kind: "keyword", insertText: "or" },
  { label: "not", kind: "keyword", insertText: "not" },
  { label: "true", kind: "keyword", insertText: "true" },
  { label: "false", kind: "keyword", insertText: "false" },
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
