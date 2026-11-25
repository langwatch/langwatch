/**
 * A card face speaks the reader's words: no stock widget shows a request-internal term
 * (trace, span, bucket, percentile, evaluator, judge and the like) in what it draws or in its
 * info tip. Queries, keys and setup code may use them; only visible copy is scanned.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { describe, expect, it } from "vitest";

import { BOARD_TEMPLATES } from "../../templates/index.ts";
import { CALLS_TO_ACTION } from "../../templates/model/widget-calls-to-action.ts";
import { CATALOGUE_WIDGETS, IMPLEMENTED_WIDGET_IDS, implementedWidget } from "../index.ts";

const BANNED =
  /\b(traces?|spans?|buckets?|p95|p99|percentiles?|evaluators?|LangWatchQL|LWQL|metadata|thread_id|user_id|origins?|judges?)\b/i;

// Attributes and keys whose string a reader sees, even when it is one lowercase word.
const VISIBLE_KEYS =
  /\b(?:label|header|title|sub|line|quiet|action|note|detail|name|value)[=:]\s*\{?\s*$/;

// A field's setup step names the exact key the SDK sends, as a setup snippet would.
const SETUP_KEY = /"send":\s*$/;

/** Every string literal and JSX text a widget's code can draw, leaving comments out. */
function visibleCopy(code: string): string[] {
  const source = code
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  const copy: string[] = [];
  for (const match of source.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g)) {
    const text = match[1] ?? match[2] ?? "";
    const before = source.slice(Math.max(0, (match.index ?? 0) - 20), match.index);
    const sentence = /\s/.test(text.trim()) || /^[A-Z]/.test(text);
    if (SETUP_KEY.test(before)) continue;
    if (sentence || VISIBLE_KEYS.test(before)) copy.push(text);
  }
  for (const match of source.matchAll(/(?<!=)>([^<>{}=;]*[A-Za-z][^<>{}=;]*)</g)) {
    copy.push(match[1] ?? "");
  }
  // A template literal's own words, without what its ${} parts put in.
  for (const match of source.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
    const text = (match[1] ?? "").replace(/\$\{[^{}]*\}/g, " ");
    if (/[A-Za-z]/.test(text)) copy.push(text);
  }
  return copy;
}

describe("the visible copy scan", () => {
  /** @scenario "AC242 Widget cards speak the reader's words: no request-internal terms on any card face" */
  it("reads the words of a template literal, leaving out what its expressions put in", () => {
    const copy = visibleCopy("<Stat label={`Missing traces: ${count}`} />");

    expect(copy.some((text) => text.includes("Missing traces:"))).toBe(true);
    expect(copy.some((text) => text.includes("count"))).toBe(false);
  });
});

const built = [
  ...IMPLEMENTED_WIDGET_IDS.flatMap((id) => implementedWidget(id) ?? []),
  ...BOARD_TEMPLATES.flatMap((template) => template.widgets),
];

describe("given every stock widget's card", () => {
  /** @scenario "AC242 Widget cards speak the reader's words: no request-internal terms on any card face" */
  it("draws no request-internal term in its figures, labels, notes or empty faces", () => {
    const leaks = built.flatMap(({ key, definition }) =>
      visibleCopy(definition.code)
        .filter((text) => BANNED.test(text))
        .map((text) => `${key}: ${text.trim()}`),
    );
    expect([...new Set(leaks)]).toEqual([]);
  });

  /** @scenario "AC242 Widget cards speak the reader's words: no request-internal terms on any card face" */
  it("keeps those terms out of each info tip, title and setup step", () => {
    const texts = [
      ...built.map(({ key, definition }) => `${key}: ${definition.description ?? ""}`),
      ...built.map(({ key, name }) => `${key}: ${name}`),
      ...CATALOGUE_WIDGETS.flatMap(({ id, title }) => `${id}: ${title}`),
      ...Object.entries(CALLS_TO_ACTION).flatMap(([source, { title, line, button, quiet }]) =>
        [title, line, button, quiet].map((text) => `${source}: ${text}`),
      ),
    ];
    expect(texts.filter((text) => BANNED.test(text.slice(text.indexOf(": ") + 2)))).toEqual([]);
  });
});
