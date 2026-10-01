import {
  describeAnnotationAnchor,
  readableAnnotationAnchor,
  type AnnotationAnchorStorage,
} from "@langwatch/annotation-contract";
import { z } from "zod";

const scoreAnswerSchema = z.object({
  value: z.unknown().optional(),
  reason: z.unknown().optional(),
});
const scoreAnswersSchema = z.record(z.string(), z.unknown());

export type AnnotationScoreValue = {
  /** Optional because the wire drops the key when the annotation scored nothing. */
  scoreOptions?: unknown;
};

/** The part of a trace an annotation was left on, in words. */
export function annotationAnchorLabel({
  annotation,
  traceId,
}: {
  annotation: AnnotationAnchorStorage;
  traceId: string;
}): string | null {
  const anchor = readableAnnotationAnchor(annotation);

  return describeAnnotationAnchor({ anchor, traceId });
}

export interface AnnotationScoreAnswer {
  name: string;
  values: string[];
  reason: string | null;
}

function answeredValues(value: unknown): string[] {
  const answers = Array.isArray(value) ? value : [value];

  return answers
    .filter((answer) => answer !== null && answer !== void 0 && answer !== "")
    .map(String);
}

function givenReason(reason: unknown): string | null {
  return typeof reason === "string" && reason ? reason : null;
}

function toScoreAnswer({
  scoreId,
  value,
  scoreNamesById,
}: {
  scoreId: string;
  value: unknown;
  scoreNamesById?: Map<string, string>;
}): AnnotationScoreAnswer | null {
  const parsed = scoreAnswerSchema.safeParse(value);

  if (!parsed.success) {
    return null;
  }

  const values = answeredValues(parsed.data.value);

  if (values.length === 0) {
    return null;
  }

  return {
    name: scoreNamesById?.get(scoreId) ?? scoreId,
    values,
    reason: givenReason(parsed.data.reason),
  };
}

export function annotationScores({
  annotation,
  scoreNamesById,
}: {
  annotation: AnnotationScoreValue;
  scoreNamesById?: Map<string, string>;
}): AnnotationScoreAnswer[] {
  const parsed = scoreAnswersSchema.safeParse(annotation.scoreOptions);

  if (!parsed.success) {
    return [];
  }

  return Object.entries(parsed.data)
    .map(([scoreId, value]) => toScoreAnswer({ scoreId, value, scoreNamesById }))
    .filter((score): score is AnnotationScoreAnswer => score !== null);
}

export function countAnnotationScores(annotations: AnnotationScoreValue[]): number {
  return annotations.reduce(
    (total, annotation) => total + annotationScores({ annotation }).length,
    0,
  );
}

export function annotationScoresLine({
  annotation,
  scoreNamesById,
}: {
  annotation: AnnotationScoreValue;
  scoreNamesById?: Map<string, string>;
}): string | null {
  const scores = annotationScores({ annotation, scoreNamesById });

  if (scores.length === 0) {
    return null;
  }

  return scores
    .map((score) => {
      const answered = `${score.name}: ${score.values.join(", ")}`;

      return score.reason ? `${answered} (${score.reason})` : answered;
    })
    .join(" · ");
}
