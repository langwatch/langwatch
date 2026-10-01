/** Keep switch values aligned with the contract schema. */

import { annotationScoreDataTypeSchema } from "@langwatch/annotation-contract";

export const AnnotationScoreDataType = Object.fromEntries(
  annotationScoreDataTypeSchema.options.map((option) => [option, option]),
) as { [K in (typeof annotationScoreDataTypeSchema.options)[number]]: K };
