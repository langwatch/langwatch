/**
 * One eval call, as the question it asks. Options are located by parameter
 * name rather than by position, because the catalogue declares both and a
 * function that gains an argument would otherwise shift every reader here.
 * @see specs/lwql/eval-functions.feature
 */

import type {
  LangWatchQLAppFunctionCall,
  LangWatchQLAppFunctionOption,
  LangWatchQLColumn,
  LangWatchQLJudgementAsked,
  LangWatchQLJudgementCall,
} from "@langwatch/analytics-contract";
import {
  computeInstantEvalTranscriptFit,
  type InstantEvalApi,
  type InstantEvalTranscriptFit,
} from "@langwatch/instant-eval-contract";

import { findLangWatchQLAppFunctions } from "../features/app-functions/rules/langwatch-ql-app-function-catalog.rules.ts";
import type { LangWatchQLAppFunctionDefinition } from "../features/app-functions/rules/langwatch-ql-app-function-shapes.rules.ts";

/** Where a boolean call with no threshold of its own draws the line. */
const LWQL_DEFAULT_JUDGEMENT_THRESHOLD = 0.5;

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

const pickNumberOption = (lookup: OptionLookup): number | null => {
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
    const min = pickNumberOption({ definition, options, name: "min" });
    const max = pickNumberOption({ definition, options, name: "max" });
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
    pickNumberOption({ definition, options, name: "threshold" }) ?? LWQL_DEFAULT_JUDGEMENT_THRESHOLD
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

/**
 * The result's columns with every judged one typed as its eval function answers, not as the
 * text it was read from: the verdict is what the cell holds once the query has judged.
 */
export function langWatchQLJudgedColumns({
  columns,
  appFunctions,
}: {
  columns: readonly LangWatchQLColumn[];
  appFunctions: readonly LangWatchQLAppFunctionCall[];
}): readonly LangWatchQLColumn[] {
  const judgedTypes = new Map<string, string>();
  for (const call of appFunctions) {
    const [definition] = findLangWatchQLAppFunctions(call.function);
    if (definition?.kind === "eval") judgedTypes.set(call.column, definition.returns);
  }

  return columns.map((column) => {
    const type = judgedTypes.get(column.name);
    return type === undefined ? column : { ...column, type };
  });
}

/** The judged columns written over `conversation`, which a judge's budget re-renders. */
export function pickLangWatchQLConversationJudgements(
  calls: readonly LangWatchQLAppFunctionCall[],
): readonly LangWatchQLAppFunctionCall[] {
  return calls.filter(
    (call) =>
      call.source?.function === "conversation" &&
      findLangWatchQLAppFunctions(call.function)[0]?.kind === "eval",
  );
}

/**
 * Each judged conversation column's fit under the judge's own limits (Alex, 2026-10-08, round
 * 26 CD-4). Columns over the same conversation share one text and so one budget: their
 * questions are asked together. A group whose questions leave no text gets none.
 */
export function computeLangWatchQLConversationFits({
  calls,
  limits,
}: {
  calls: readonly LangWatchQLAppFunctionCall[];
  limits: ReturnType<InstantEvalApi["getJudgeLimits"]>;
}): ReadonlyMap<string, InstantEvalTranscriptFit> {
  const groups = new Map<string, LangWatchQLAppFunctionCall[]>();
  for (const call of pickLangWatchQLConversationJudgements(calls)) {
    const signature = JSON.stringify([call.source?.function, call.source?.options]);
    groups.set(signature, [...(groups.get(signature) ?? []), call]);
  }

  const fits = new Map<string, InstantEvalTranscriptFit>();
  for (const group of groups.values()) {
    const fit = computeInstantEvalTranscriptFit({
      judgements: langWatchQLJudgementCalls(group),
      limits,
    });
    if (!fit) continue;
    for (const call of group) fits.set(call.column, fit);
  }

  return fits;
}
