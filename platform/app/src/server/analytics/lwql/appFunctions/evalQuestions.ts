/**
 * One eval call, as a question and then as a cell.
 *
 * The plan holds what the caller wrote — a function name and its literal
 * options — and the classifier takes a typed question. This module is the
 * translation, both ways, and it is the only place that knows which option of
 * an eval function is its threshold, its range or its list.
 *
 * Options are located **by parameter name** rather than by position. The
 * catalog is the declaration of both, and a function that gains an argument
 * later would otherwise silently shift what every reader here picks up.
 *
 * The question id is the output column. It is unique within a statement
 * (an alias is required and two projection entries cannot share one), and using
 * it means the answer comes back already addressed to the cell it belongs in.
 *
 * @see ./evalCatalog.ts
 * @see ../../../app-layer/instant-evals/classifier/classifier.ts
 */

import type {
  InstantEvalQuestion,
  InstantEvalVerdict,
} from "~/server/app-layer/instant-evals/classifier/classifier";
import type { LangWatchQLAppFunctionDefinition } from "./catalog";
import type { LangWatchQLAppFunctionOption } from "./plan";

/** The option a parameter name declares, or `undefined`. */
function optionNamed({
  definition,
  options,
  name,
}: {
  definition: LangWatchQLAppFunctionDefinition;
  options: readonly LangWatchQLAppFunctionOption[];
  name: string;
}): LangWatchQLAppFunctionOption | undefined {
  const index = definition.parameters
    .filter((parameter) => parameter.role === "option")
    .findIndex((parameter) => parameter.name === name);
  return index < 0 ? undefined : options[index];
}

function textOption(value: LangWatchQLAppFunctionOption | undefined): string {
  return typeof value === "string" ? value : "";
}

function numberOption(
  value: LangWatchQLAppFunctionOption | undefined,
): number | null {
  return typeof value === "number" ? value : null;
}

function listOption(
  value: LangWatchQLAppFunctionOption | undefined,
): readonly string[] {
  return Array.isArray(value) ? value : [];
}

/**
 * The question one eval call asks.
 *
 * Throws on an option the validator should already have refused: the plan is
 * written by one module and read by another, and a question built from a
 * missing option would reach the judge as a malformed request per row.
 */
export function instantEvalQuestionFor({
  definition,
  options,
  column,
}: {
  definition: LangWatchQLAppFunctionDefinition;
  options: readonly LangWatchQLAppFunctionOption[];
  column: string;
}): InstantEvalQuestion {
  const judgement = definition.judgement;
  if (!judgement) {
    throw new Error(
      `lwql hydration: "${definition.name}" is not a judged function`,
    );
  }
  const instructions = textOption(
    optionNamed({ definition, options, name: "instructions" }),
  );

  if (judgement.kind === "boolean") {
    const criteria = listOption(
      optionNamed({ definition, options, name: "criteria" }),
    );
    const [yes, no] = criteria;
    return {
      id: column,
      kind: "boolean",
      instructions,
      ...(yes !== undefined && no !== undefined
        ? { criteria: [yes, no] as const }
        : {}),
    };
  }

  if (judgement.kind === "score") {
    const min = numberOption(optionNamed({ definition, options, name: "min" }));
    const max = numberOption(optionNamed({ definition, options, name: "max" }));
    if (min === null || max === null) {
      throw new Error(
        `lwql hydration: "${definition.name}" needs both ends of its scale`,
      );
    }
    return { id: column, kind: "score", instructions, range: { min, max } };
  }

  return {
    id: column,
    kind: "category",
    instructions,
    options: listOption(
      optionNamed({ definition, options, name: "options" }),
    ).map(splitNameAndDescription),
  };
}

/**
 * `refund: wants money back` as a name and a gloss.
 *
 * The first colon separates them, so a description may contain as many more as
 * it likes. The validator already refused an entry without one.
 */
function splitNameAndDescription(entry: string): {
  name: string;
  description: string;
} {
  const colon = entry.indexOf(":");
  if (colon <= 0) return { name: entry.trim(), description: entry.trim() };
  return {
    name: entry.slice(0, colon).trim(),
    description: entry.slice(colon + 1).trim(),
  };
}

/**
 * What the column holds, given the verdict its question got.
 *
 * `null` wherever the verdict does not carry the part this function publishes —
 * an unjudged cell, never a defaulted one.
 */
export function judgedCellValue({
  definition,
  options,
  verdict,
}: {
  definition: LangWatchQLAppFunctionDefinition;
  options: readonly LangWatchQLAppFunctionOption[];
  verdict: InstantEvalVerdict | undefined;
}): string | number | null {
  if (!verdict || !definition.judgement) return null;

  switch (definition.judgement.reads) {
    case "probability":
      return verdict.probability ?? null;
    case "passed":
      return passedValue({ definition, options, verdict });
    case "score":
      return verdict.score ?? null;
    case "label":
      return verdict.label ?? null;
    default:
      return verdict.probabilities
        ? JSON.stringify(verdict.probabilities)
        : null;
  }
}

function passedValue({
  definition,
  options,
  verdict,
}: {
  definition: LangWatchQLAppFunctionDefinition;
  options: readonly LangWatchQLAppFunctionOption[];
  verdict: InstantEvalVerdict;
}): number | null {
  const threshold = numberOption(
    optionNamed({ definition, options, name: "threshold" }),
  );
  if (threshold === null || verdict.probability === undefined) return null;
  return verdict.probability >= threshold ? 1 : 0;
}
