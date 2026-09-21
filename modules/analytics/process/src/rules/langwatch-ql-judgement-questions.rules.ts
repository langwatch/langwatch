/**
 * One eval call, as the question it asks. Options are located by parameter
 * name rather than by position, because the catalogue declares both and a
 * function that gains an argument would otherwise shift every reader here.
 * @see specs/lwql/eval-functions.feature
 */

import type {
  LangWatchQLAppFunctionCall,
  LangWatchQLAppFunctionOption,
  LangWatchQLJudgementAsked,
  LangWatchQLJudgementCall,
} from "@langwatch/analytics-contract";

import { findLangWatchQLAppFunctions } from "./langwatch-ql-app-function-catalog.rules.ts";
import type { LangWatchQLAppFunctionDefinition } from "./langwatch-ql-app-function-shapes.rules.ts";

/** Where a boolean call with no threshold of its own draws the line. */
export const LWQL_DEFAULT_JUDGEMENT_THRESHOLD = 0.5;

/** What one option lookup is asked. */
type OptionLookup = {
  definition: LangWatchQLAppFunctionDefinition;
  options: readonly LangWatchQLAppFunctionOption[];
  name: string;
};

/** Where this parameter's literal sits among the call's options, or past them. */
const optionNamed = ({ definition, options, name }: OptionLookup) =>
  options[
    definition.parameters
      .filter((parameter) => parameter.role === "option")
      .findIndex((parameter) => parameter.name === name)
  ];

const textOption = (lookup: OptionLookup): string => {
  const value = optionNamed(lookup);

  return typeof value === "string" ? value : "";
};

const numberOption = (lookup: OptionLookup): number | null => {
  const value = optionNamed(lookup);

  return typeof value === "number" ? value : null;
};

const listOption = (lookup: OptionLookup): readonly string[] => {
  const value = optionNamed(lookup);

  return Array.isArray(value) ? value : [];
};

/**
 * `refund: wants money back` as a name and a gloss. The first colon separates
 * them, so a description may hold as many more as it likes; the validator
 * already refused an entry without one.
 */
function splitNameAndDescription(entry: string): { name: string; description: string } {
  const colon = entry.indexOf(":");
  if (colon <= 0) return { name: entry.trim(), description: entry.trim() };

  return { name: entry.slice(0, colon).trim(), description: entry.slice(colon + 1).trim() };
}

/**
 * Throws on an option the validator should already have refused: a question
 * built from a missing one would reach the judge malformed, once per row.
 */
function judgementAsked({
  definition,
  options,
}: {
  definition: LangWatchQLAppFunctionDefinition;
  options: readonly LangWatchQLAppFunctionOption[];
}): LangWatchQLJudgementAsked {
  const instructions = textOption({ definition, options, name: "instructions" });
  const kind = definition.judgement?.kind;

  if (kind === "boolean") {
    const [yes, no] = listOption({ definition, options, name: "criteria" });

    return {
      kind: "boolean",
      instructions,
      ...(yes !== undefined && no !== undefined ? { criteria: [yes, no] as const } : {}),
    };
  }

  if (kind === "score") {
    const min = numberOption({ definition, options, name: "min" });
    const max = numberOption({ definition, options, name: "max" });
    if (min === null || max === null) {
      throw new Error(`lwql judgement: "${definition.name}" needs both ends of its scale`);
    }

    return { kind: "score", instructions, range: { min, max } };
  }

  return {
    kind: "category",
    instructions,
    options: listOption({ definition, options, name: "options" }).map(splitNameAndDescription),
  };
}

/** The line a boolean call's probability has to clear to count as passed. */
function thresholdOf({
  definition,
  options,
}: {
  definition: LangWatchQLAppFunctionDefinition;
  options: readonly LangWatchQLAppFunctionOption[];
}): number {
  return (
    numberOption({ definition, options, name: "threshold" }) ?? LWQL_DEFAULT_JUDGEMENT_THRESHOLD
  );
}

/**
 * The judged columns a hydration plan asks for. Empty for a statement that
 * projects no eval function, which is what a run refuses on: it would judge
 * nothing and cost nothing.
 */
export function langWatchQLJudgementCalls(
  calls: readonly LangWatchQLAppFunctionCall[],
): readonly LangWatchQLJudgementCall[] {
  const judgements: LangWatchQLJudgementCall[] = [];

  for (const call of calls) {
    const [definition] = findLangWatchQLAppFunctions(call.function);
    const judgement = definition?.judgement;
    if (!definition || !judgement) continue;

    judgements.push({
      column: call.column,
      function: definition.name,
      reads: judgement.reads,
      ...(judgement.kind === "boolean"
        ? { threshold: thresholdOf({ definition, options: call.options }) }
        : {}),
      ...judgementAsked({ definition, options: call.options }),
    });
  }

  return judgements;
}
