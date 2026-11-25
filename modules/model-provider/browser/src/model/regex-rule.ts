/** Whether a cost rule's regex matches a model string, and the colouring of a regex. */

import { tryCompileSafeRegex } from "./safe-regex.ts";

export type RuleVerdict = "match" | "no-match" | "invalid";

/**
 * Same engine as the server: a flagless JS `RegExp` that passes safe-regex2, tried on the
 * model and then on what follows its first "/" (the server's provider-prefix fallback).
 */
export function ruleVerdict(args: { regex: string; model: string }): RuleVerdict {
  const expression = tryCompileSafeRegex(args.regex);
  if (!expression) return "invalid";
  const { model } = args;
  if (expression.test(model)) return "match";
  const slash = model.indexOf("/");
  return slash >= 0 && expression.test(model.slice(slash + 1)) ? "match" : "no-match";
}

export type RegexTokenKind = "group" | "class" | "anchor" | "quantifier" | "escape" | "literal";

const TOKEN = new RegExp(
  [
    String.raw`(?<class>\\[dDwWsS]|\[(?:\\[\s\S]|[^\]\\])*\]?|\.)`,
    String.raw`(?<anchor>\\[bB]|[\^$])`,
    String.raw`(?<escape>\\[\s\S])`,
    String.raw`(?<group>\((?:\?(?::|=|!|<=|<!|<[A-Za-z_]\w*>))?|[)|])`,
    String.raw`(?<quantifier>[*+?]|\{\d+(?:,\d*)?\})`,
    String.raw`(?<literal>[\s\S])`,
  ].join("|"),
  "g",
);

/** Splits a pattern into coloured runs; concatenating the texts gives the pattern back. */
export function tokenizeRegex(pattern: string): { text: string; kind: RegexTokenKind }[] {
  return [...pattern.matchAll(TOKEN)].map((match) => ({
    text: match[0],
    kind: Object.keys(match.groups!).find(
      (name) => match.groups![name] !== undefined,
    ) as RegexTokenKind,
  }));
}
