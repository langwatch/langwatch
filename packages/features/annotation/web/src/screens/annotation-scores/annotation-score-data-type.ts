/**
 * The score data types, as values.
 *
 * `@langwatch/annotation-contract` declares `annotationScoreDataTypeSchema` and
 * derives the TYPE from it, which is everything a payload needs and not enough
 * for a `switch`: this page compares a definition's `dataType` against
 * `OPTION` and `CHECKBOX` to decide what the editor shows and what the table
 * prints.
 *
 * Derived from the schema rather than restated beside it, so a sixth member
 * added to the enum arrives here with no second edit and no chance of drifting.
 */

import { annotationScoreDataTypeSchema } from "@langwatch/annotation-contract";

export const AnnotationScoreDataType = Object.fromEntries(
  annotationScoreDataTypeSchema.options.map((option) => [option, option]),
) as { [K in (typeof annotationScoreDataTypeSchema.options)[number]]: K };
