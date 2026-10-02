/** Reading an annotation's answered scores. Pure: consumers fetch. */
import { z } from "zod";

const scoreAnswerSchema = z.object({
  value: z.unknown().optional(),
  reason: z.unknown().optional(),
});
const scoreAnswersSchema = z.record(z.string(), z.unknown());

export type ScoredAnnotation = {
  /** Optional because the wire drops the key when the annotation scored nothing. */
  scoreOptions?: unknown;
};

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
    reason:
      typeof parsed.data.reason === "string" && parsed.data.reason ? parsed.data.reason : null,
  };
}

export function annotationScores({
  annotation,
  scoreNamesById,
}: {
  annotation: ScoredAnnotation;
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

export function countAnnotationScores(annotations: ScoredAnnotation[]): number {
  return annotations.reduce(
    (total, annotation) => total + annotationScores({ annotation }).length,
    0,
  );
}
