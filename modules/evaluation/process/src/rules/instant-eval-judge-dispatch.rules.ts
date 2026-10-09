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

/** The judge Instant Evals answers for these settings, or `runs_as_today` for any other. */
export function instantEvalJudgeOf({
  evaluatorType,
  settings,
}: {
  evaluatorType: string;
  settings: Record<string, unknown> | undefined;
}): { kind: "instant_eval"; judge: InstantEvalJudge } | { kind: "runs_as_today" } {
  if (settings?.model !== INSTANT_EVAL_JUDGE_MODEL_ID) return { kind: "runs_as_today" };

  const prompt = textOr({
    value: settings.prompt,
    fallback: defaultOf({ evaluatorType, key: "prompt" }),
  });
  switch (evaluatorType) {
    case "langevals/llm_boolean":
      return { kind: "instant_eval", judge: { evaluatorType, settings: { prompt } } };
    case "langevals/llm_score":
      return {
        kind: "instant_eval",
        judge: {
          evaluatorType,
          settings: {
            prompt,
            ...(typeof settings.min === "number" ? { min: settings.min } : {}),
            ...(typeof settings.max === "number" ? { max: settings.max } : {}),
          },
        },
      };
    case "langevals/llm_category": {
      const saved = findCategories(settings.categories);
      const categories =
        saved.length > 0 ? saved : findCategories(defaultOf({ evaluatorType, key: "categories" }));
      return { kind: "instant_eval", judge: { evaluatorType, settings: { prompt, categories } } };
    }
    default:
      return { kind: "runs_as_today" };
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
  const contexts = contextsOf(data.contexts);
  return {
    ...(data.input === undefined || data.input === null ? {} : { input: textOf(data.input) }),
    ...(data.output === undefined || data.output === null ? {} : { output: textOf(data.output) }),
    ...(contexts.length === 0 ? {} : { contexts }),
  };
}

function textOr({ value, fallback }: { value: unknown; fallback: unknown }): string {
  if (typeof value === "string" && value.trim()) return value;
  return typeof fallback === "string" ? fallback : "";
}

function findCategories(value: unknown): { name: string; description: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((category: unknown) => {
    if (!category || typeof category !== "object") return [];
    const { name, description } = category as { name?: unknown; description?: unknown };
    if (typeof name !== "string") return [];
    return [{ name, description: typeof description === "string" ? description : "" }];
  });
}

/** A present mapped value as text; the caller leaves absent ones out. */
function textOf(value: unknown): string {
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
