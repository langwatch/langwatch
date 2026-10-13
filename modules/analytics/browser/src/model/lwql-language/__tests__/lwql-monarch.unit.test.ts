/**
 * @see modules/analytics/specs/analytics-lwql-editor.feature
 */
import type { languages } from "monaco-editor";
import { describe, expect, it } from "vitest";

import { lwqlMonarch, lwqlVocabularyOf } from "../lwql-monarch.ts";
import { SCHEMA } from "./lwql-fixture.fixture.ts";

type Token = { text: string; token: string };

const grammar = lwqlMonarch(lwqlVocabularyOf(SCHEMA));

function inWordList({ key, word }: { key: string; word: string }): boolean {
  const list: string[] = grammar[key.replace("@", "")] ?? [];
  return list.some((entry) => entry.toLowerCase() === word.toLowerCase());
}

/** The one token a rule gives a word, reading `cases` against the grammar's own word lists. */
function tokenOf({ action, word }: { action: unknown; word: string }): string {
  if (typeof action === "string") return action;
  if (typeof action !== "object" || action === null || !("cases" in action)) return "";
  const cases = Object.entries(Object.assign({}, action.cases));
  const hit = cases.find(([key]) => key === "@default" || inWordList({ key, word }));
  const token = hit?.[1];
  return typeof token === "string" ? token : "";
}

function ruleParts(rule: languages.IMonarchLanguageRule) {
  if (!Array.isArray(rule) || !(rule[0] instanceof RegExp)) return undefined;
  return { pattern: rule[0], action: rule[1], next: rule[2] };
}

/** A minimal Monarch runner: first rule matching at the position wins; states push and pop. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const stack = ["root"];
  let at = 0;
  while (at < text.length) {
    const rules = grammar.tokenizer[stack[stack.length - 1] ?? "root"] ?? [];
    const step = rules.flatMap((rule) => {
      const parts = ruleParts(rule);
      if (!parts) return [];
      const sticky = new RegExp(parts.pattern.source, "iym");
      sticky.lastIndex = at;
      const match = sticky.exec(text);
      return match && match[0].length > 0 ? [{ match: match[0], ...parts }] : [];
    })[0];
    if (!step) {
      at += 1;
      continue;
    }
    tokens.push({ text: step.match, token: tokenOf({ action: step.action, word: step.match }) });
    if (step.next === "@pop") stack.pop();
    else if (step.next) stack.push(step.next.replace("@", ""));
    at += step.match.length;
  }
  return tokens.filter((t) => t.token !== "white");
}

const kindOf = ({ tokens, text }: { tokens: Token[]; text: string }) =>
  tokens.find((t) => t.text === text)?.token;

const listedCall = tokenize("SELECT quantile_ms(DurationMs)");
const unlistedCall = tokenize("SELECT made_up(DurationMs)");
const lowerCase = tokenize("select TraceId from analytics.spans");
const literals = tokenize("WHERE a = 'x''y' -- note\n AND b > 1.5 /* c */ {dashboard:DateTime}");

describe("the LangWatchQL grammar", () => {
  describe("given a schema naming functions, datasets and columns", () => {
    describe("when a statement is tokenized", () => {
      /** @scenario "Function tokens come from the schema's functions list, not a hard-coded list" */
      it("colours a call to a schema function and leaves an unlisted name plain", () => {
        expect(kindOf({ tokens: listedCall, text: "quantile_ms" })).toBe("predefined");
        expect(kindOf({ tokens: unlistedCall, text: "made_up" })).toBe("identifier");
      });

      it("knows keywords whatever their case, and the schema's datasets and columns", () => {
        expect(kindOf({ tokens: lowerCase, text: "select" })).toBe("keyword");
        expect(kindOf({ tokens: lowerCase, text: "spans" })).toBe("type.identifier");
        expect(kindOf({ tokens: lowerCase, text: "TraceId" })).toBe("attribute.name");
      });

      it("reads strings, numbers, comments and bound parameters", () => {
        expect(kindOf({ tokens: literals, text: "''" })).toBe("string.escape");
        expect(kindOf({ tokens: literals, text: "-- note" })).toBe("comment");
        expect(kindOf({ tokens: literals, text: " c " })).toBe("comment");
        expect(kindOf({ tokens: literals, text: "1.5" })).toBe("number");
        expect(kindOf({ tokens: literals, text: "{dashboard:DateTime}" })).toBe(
          "variable.parameter",
        );
      });
    });
  });
});
