import { defineRule } from "../define-rule.mjs";
import { isCommentScannedPath } from "./comment-block-size.rule.mjs";

// A house rule is not ignorable: a directive naming a `langwatch/*` rule is an
// error unless that rule opted in through `defineRule({ escape })`, and then
// only with a reason that says why the framework cannot be used.

export const MIN_REASON_WORDS = 5;

const HOUSE_PREFIX = "langwatch/";
const DIRECTIVE = /^\s*((?:eslint|oxlint)-disable(?:-next-line|-line)?)(?=\s|$)([\s\S]*)$/;
const REASON_SEPARATOR = /\s-{2,}(?:\s|$)/;
const PLACEHOLDER =
  /\b(?:todo|fixme|tbd|wip|hack|temp|temporary|fix later|legacy|needed|ignore|false positive)\b/gi;
const WORD = /[\p{L}\p{N}]/u;

/** A disable directive's spelling, the rules it names, and the text after `--`. */
export function parseDisableDirective(text) {
  const match = DIRECTIVE.exec(text);
  if (match === null) return null;

  const separator = REASON_SEPARATOR.exec(match[2]);
  const names = separator === null ? match[2] : match[2].slice(0, separator.index);
  const reason = separator === null ? "" : match[2].slice(separator.index + separator[0].length);
  const ruleNames = names
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");

  return { directive: match[1], reason: reason.trim(), ruleNames };
}

/** A reason counts when, placeholders struck out, at least five words remain. */
export function isRealReason(reason) {
  const words = reason.replace(PLACEHOLDER, " ").split(/\s+/);

  return words.filter((word) => WORD.test(word)).length >= MIN_REASON_WORDS;
}

/** The message a directive earns for one rule it names, or undefined when it stands. */
function refusalOf({ escapable, reason, rule }) {
  if (!escapable.has(rule.slice(HOUSE_PREFIX.length))) return "houseRuleDisabled";
  if (reason === "") return "reasonMissing";

  return isRealReason(reason) ? undefined : "reasonVague";
}

/** Reports each house rule one directive comment turns off without the standing to. */
function reportDirective({ comment, context, escapable }) {
  const parsed = parseDisableDirective(comment.value);
  if (parsed === null) return;

  const loc = { line: comment.loc.start.line, column: comment.loc.start.column };
  for (const rule of parsed.ruleNames.filter((name) => name.startsWith(HOUSE_PREFIX))) {
    const messageId = refusalOf({ escapable, reason: parsed.reason, rule });
    const data = { directive: parsed.directive, reason: parsed.reason, rule };
    if (messageId) context.report({ loc, messageId, data });
  }
}

const ASK_THE_HUMAN = "if the case is confusing, stop and ask the human";

/** The rule, closed over the house rules it judges, so it never imports the registry it sits in. */
export function suppressionStatesWhyRuleFor({ houseRules }) {
  const escapable = new Set(
    houseRules.filter((rule) => rule.meta.docs.escape).map((rule) => rule.meta.docs.name),
  );

  return defineRule({
    name: "suppression-states-why",
    kind: "problem",
    messages: {
      houseRuleDisabled: {
        what: "`{{directive}}` turns off `{{rule}}`, a house rule that cannot be disabled.",
        why: "The langwatch rules state the architecture; a disable would let the code drift. Read the `linting` skill.",
        fix:
          "Delete the directive and change the code the way `{{rule}}`'s own message says;" +
          ` ${ASK_THE_HUMAN} instead of disabling it.`,
      },
      reasonMissing: {
        what: "`{{directive}} {{rule}}` gives no reason.",
        why: "A disable is a claim that the framework cannot express this case.",
        fix:
          "Append `-- <why the framework cannot express this case>` as a sentence of at least" +
          ` ${MIN_REASON_WORDS} words; if you cannot say why, delete the directive and use the` +
          ` shape \`{{rule}}\` names, and ${ASK_THE_HUMAN}.`,
      },
      reasonVague: {
        what: "The reason on `{{directive}} {{rule}}`, `{{reason}}`, does not say why.",
        why: "A placeholder or a few words is a bare disable with decoration.",
        fix:
          `Rewrite it as a sentence of at least ${MIN_REASON_WORDS} words naming what the` +
          " framework cannot express; if you cannot say why, delete the directive and use the" +
          ` shape \`{{rule}}\` names, and ${ASK_THE_HUMAN}.`,
      },
    },
    create(context, file) {
      if (!isCommentScannedPath(file.workspacePath)) return {};

      return {
        Program(program) {
          for (const comment of program.comments ?? [])
            reportDirective({ comment, context, escapable });
        },
      };
    },
  });
}
