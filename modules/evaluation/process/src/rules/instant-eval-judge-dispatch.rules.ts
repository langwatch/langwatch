/**
 * Which evaluations Instant Evals answers, and what their mapped data reads as (ADR-174
 * decisions 1 and 11): an LLM judge whose model is Instant Evals, never any other evaluator.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import { AVAILABLE_EVALUATORS } from "@langwatch/evaluator-contract";
import { INSTANT_EVAL_JUDGE_MODEL_ID } from "@langwatch/instant-eval-judge-contract";

import type {
  InstantEvalJudge,
  InstantEvalJudgeInputs,
} from "./instant-eval-judge-question.rules.ts";

/** The judge Instant Evals answers for these settings, or null when the evaluator runs as today. */
export function instantEvalJudgeOf({
  evaluatorType,
  settings,
}: {
  evaluatorType: string;
  settings: Record<string, unknown> | undefined;
}): InstantEvalJudge | null {
  if (settings?.model !== INSTANT_EVAL_JUDGE_MODEL_ID) return null;

  const prompt = textOr({
    value: settings.prompt,
    fallback: defaultOf({ evaluatorType, key: "prompt" }),
  });
  switch (evaluatorType) {
    case "langevals/llm_boolean":
      return { evaluatorType, settings: { prompt } };
    case "langevals/llm_score":
      return {
        evaluatorType,
        settings: {
          prompt,
          ...(typeof settings.min === "number" ? { min: settings.min } : {}),
          ...(typeof settings.max === "number" ? { max: settings.max } : {}),
        },
      };
    case "langevals/llm_category":
      return {
        evaluatorType,
        settings: {
          prompt,
          categories:
            categoriesOf(settings.categories) ??
            categoriesOf(defaultOf({ evaluatorType, key: "categories" })) ??
            [],
        },
      };
    default:
      return null;
  }
}

/** A setting's generated default, read loosely: the generated map types each default per field. */
function defaultOf({ evaluatorType, key }: { evaluatorType: string; key: string }): unknown {
  const definition = AVAILABLE_EVALUATORS[evaluatorType as keyof typeof AVAILABLE_EVALUATORS];
  const settings = definition?.settings as Record<string, { default?: unknown }> | undefined;
  return settings?.[key]?.default;
}

/** The judge's mapped fields as text: structured values as JSON, each context as its text. */
export function instantEvalJudgeInputsOf(data: Record<string, unknown>): InstantEvalJudgeInputs {
  const input = textOf(data.input);
  const output = textOf(data.output);
  const contexts = contextsOf(data.contexts);
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(contexts.length === 0 ? {} : { contexts }),
  };
}

function textOr({ value, fallback }: { value: unknown; fallback: unknown }): string {
  if (typeof value === "string" && value.trim()) return value;
  return typeof fallback === "string" ? fallback : "";
}

function categoriesOf(value: unknown): { name: string; description: string }[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const categories = value.flatMap((category: unknown) => {
    if (!category || typeof category !== "object") return [];
    const { name, description } = category as { name?: unknown; description?: unknown };
    if (typeof name !== "string") return [];
    return [{ name, description: typeof description === "string" ? description : "" }];
  });
  return categories.length > 0 ? categories : undefined;
}

function textOf(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function contextsOf(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const items: unknown[] = Array.isArray(value) ? value : [value];
  return items.flatMap((item) => {
    if (item === undefined || item === null) return [];
    if (typeof item === "string") return [item];
    const content = (item as { content?: unknown }).content;
    return [typeof content === "string" ? content : JSON.stringify(item)];
  });
}
