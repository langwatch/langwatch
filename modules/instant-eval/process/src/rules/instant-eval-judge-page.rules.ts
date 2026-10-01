/**
 * A page of extracted texts and what judging it produces: the requests it
 * sends, the ceiling it may not send past, and the cells the answers fill.
 * One request per distinct text of a row, and it carries every question asked.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import {
  InstantEvalQueryBudgetExceededError,
  InstantEvalQuestionsTooLongError,
  type InstantEvalClassifierLimits,
  type InstantEvalQuestion,
  type InstantEvalVerdict,
} from "@langwatch/instant-eval-contract";

import { instantEvalRowText } from "./instant-eval-row-keys.rules.ts";
import type { InstantEvalRunQuestion } from "./instant-eval-run-questions.rules.ts";
import {
  estimateInstantEvalRequestTokens,
  instantEvalQuestionTokens,
  instantEvalTextBudget,
} from "./instant-eval-token-budget.rules.ts";
import { instantEvalJudgedCellFor } from "./instant-eval-verdicts.rules.ts";

/** One text of one row, and every question asked about that text. */
export interface InstantEvalJudgementUnit {
  /** Which row of the page the answer fills the cells of. */
  readonly rowIndex: number;
  readonly text: string;
  readonly questions: readonly InstantEvalRunQuestion[];
}

/**
 * The requests a page sends. Rows are never packed together: the bench
 * measured 98% agreement on single texts against 87% on eight packed into one
 * request, which is a seventh of the cost for eleven points of accuracy.
 */
export function instantEvalJudgementUnits({
  rows,
  questions,
  limits,
}: {
  readonly rows: readonly Record<string, unknown>[];
  readonly questions: readonly InstantEvalRunQuestion[];
  readonly limits: InstantEvalClassifierLimits;
}): readonly InstantEvalJudgementUnit[] {
  return rows.flatMap((row, rowIndex) => unitsForRow({ row, rowIndex, questions, limits }));
}

/** One row's units: its questions grouped by the text each one is about. */
function unitsForRow({
  row,
  rowIndex,
  questions,
  limits,
}: {
  readonly row: Record<string, unknown>;
  readonly rowIndex: number;
  readonly questions: readonly InstantEvalRunQuestion[];
  readonly limits: InstantEvalClassifierLimits;
}): InstantEvalJudgementUnit[] {
  const byText = new Map<string, InstantEvalRunQuestion[]>();
  for (const question of questions) {
    // A row whose extraction found nothing has no text to judge, which is the
    // unresolved key the extraction stage already reports. Its cell stays null.
    const text = instantEvalRowText(row, question.id);
    if (text === "") continue;
    const asked = byText.get(text);
    if (asked) asked.push(question);
    else byText.set(text, [question]);
  }

  return [...byText].map(([text, asked]) => {
    assertTextFits({ questions: asked, limits });

    return { rowIndex, text, questions: asked };
  });
}

/**
 * Refused once here rather than per row: questions that fill the judge's whole
 * state leave no room for any text, and sending the page would skip every row
 * of it and report a judge that is answering perfectly well as unusable.
 */
function assertTextFits({
  questions,
  limits,
}: {
  readonly questions: readonly InstantEvalRunQuestion[];
  readonly limits: InstantEvalClassifierLimits;
}): void {
  const asked = askedQuestions(questions);
  if (instantEvalTextBudget({ questions: asked, limits }) > 0) return;

  throw new InstantEvalQuestionsTooLongError({
    questionTokens: instantEvalQuestionTokens(asked),
    stateTokens: limits.stateTokens,
  });
}

function askedQuestions(
  questions: readonly InstantEvalRunQuestion[],
): readonly InstantEvalQuestion[] {
  return questions.map((question) => question.question);
}

/**
 * Input tokens one page may send: whatever its own rows could carry at the
 * judge's state cap. The page size is the real bound; this is the backstop
 * against a page of texts far larger than the judge takes.
 */
export function instantEvalPageTokenBudget({
  rows,
  limits,
}: {
  readonly rows: number;
  readonly limits: InstantEvalClassifierLimits;
}): number {
  return Math.max(1, rows) * limits.stateTokens;
}

/** Refuses a page before anything is sent, never after it is billed. */
export function assertInstantEvalPageBudget({
  units,
  budget,
  limits,
}: {
  readonly units: readonly InstantEvalJudgementUnit[];
  readonly budget: number;
  readonly limits: InstantEvalClassifierLimits;
}): void {
  let estimatedTokens = 0;
  for (const unit of units) {
    estimatedTokens += estimateInstantEvalRequestTokens({
      text: unit.text,
      questions: askedQuestions(unit.questions),
      limits,
    });
  }
  if (estimatedTokens <= budget) return;

  throw new InstantEvalQueryBudgetExceededError({ estimatedTokens, budget });
}

/**
 * What a page's requests answered, by row and then by question. A question
 * present with no verdict was asked and declined, which is a null cell the
 * page explains; an absent one was never asked at all.
 */
export type InstantEvalPageCells = ReadonlyMap<
  number,
  ReadonlyMap<string, InstantEvalVerdict | null>
>;

/** A page's rows with their texts replaced by the verdicts on them. */
export interface InstantEvalJudgedRows {
  readonly rows: readonly Record<string, unknown>[];
  /** Rows a stop reached before every question about them was answered. */
  readonly unjudgedRows: readonly number[];
}

/**
 * The rows as they are written: each judged column holds its verdict instead
 * of the text it was read from. A row whose question was never asked back is
 * named, because that null is the one a caller must not read as a verdict.
 */
export function instantEvalJudgedRows({
  rows,
  questions,
  cells,
}: {
  readonly rows: readonly Record<string, unknown>[];
  readonly questions: readonly InstantEvalRunQuestion[];
  readonly cells: InstantEvalPageCells;
}): InstantEvalJudgedRows {
  const unjudgedRows: number[] = [];
  const judged = rows.map((row, rowIndex) => {
    const answers = cells.get(rowIndex);
    const next: Record<string, unknown> = { ...row };
    let isUnjudged = false;
    for (const question of questions) {
      const wasAsked = instantEvalRowText(row, question.id) !== "";
      if (wasAsked && !answers?.has(question.id)) isUnjudged = true;
      next[question.id] = instantEvalJudgedCellFor({
        question,
        verdict: answers?.get(question.id) ?? undefined,
      }).cell;
    }
    if (isUnjudged) unjudgedRows.push(rowIndex);

    return next;
  });

  return { rows: judged, unjudgedRows };
}
