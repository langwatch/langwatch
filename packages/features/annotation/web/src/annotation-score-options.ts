import { z } from "zod";
import type { ScoreOptions } from "./annotation-form-types";

const annotationScoreOptionSchema = z.object({
  value: z.union([z.string(), z.array(z.string())]),
  reason: z.string().optional(),
});

const annotationScoreOptionsSchema = z.record(z.string(), z.unknown());

/** Reads stored score choices into the controlled annotation form shape. */
export function readAnnotationScoreOptions(value: unknown): ScoreOptions {
  const parsedOptions = annotationScoreOptionsSchema.safeParse(value);
  if (!parsedOptions.success) {
    return {};
  }

  const scoreOptions: ScoreOptions = {};
  for (const [scoreId, rawScore] of Object.entries(parsedOptions.data)) {
    const parsedScore = annotationScoreOptionSchema.safeParse(rawScore);
    if (parsedScore.success) {
      scoreOptions[scoreId] = parsedScore.data;
    }
  }
  return scoreOptions;
}
