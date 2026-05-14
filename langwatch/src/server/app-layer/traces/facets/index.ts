/**
 * Per-file facet definitions, aggregated for `facet-registry.ts`.
 *
 * One file per facet, with the SQL builder and the registry entry living
 * together. Co-located unit tests in `__tests__`. New facets land here —
 * the registry stays a thin assembly seam.
 */

import { EVALUATOR_FACET } from "./evaluator";
import { EVENT_ATTRIBUTE_KEYS_FACET } from "./event-attribute-keys";
import { EVENT_FACET } from "./events";
import { LABEL_FACET } from "./label";
import { METADATA_KEYS_FACET } from "./metadata-keys";
import { SPAN_ATTRIBUTE_KEYS_FACET } from "./span-attribute-keys";
import { SPAN_NAME_FACET } from "./span-name";
import { SPAN_STATUS_FACET } from "./span-status";

export {
  EVALUATOR_FACET,
  EVENT_ATTRIBUTE_KEYS_FACET,
  EVENT_FACET,
  LABEL_FACET,
  METADATA_KEYS_FACET,
  SPAN_ATTRIBUTE_KEYS_FACET,
  SPAN_NAME_FACET,
  SPAN_STATUS_FACET,
};
export { buildEvaluatorFacetQuery } from "./evaluator";
export { buildEventAttributeKeysFacetQuery } from "./event-attribute-keys";
export { buildEventsFacetQuery } from "./events";
export { buildLabelFacetQuery } from "./label";
export { buildMetadataKeysFacetQuery } from "./metadata-keys";
export { buildSpanAttributeKeysFacetQuery } from "./span-attribute-keys";
