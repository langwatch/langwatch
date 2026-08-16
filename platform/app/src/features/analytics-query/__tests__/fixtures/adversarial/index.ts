/**
 * One fixture per rejection path, each named for the path it attacks and
 * declaring the rule that must refuse it.
 *
 * `attacks` is not decoration: `adversarialCorpus.unit.test.ts` asserts each
 * fixture really is refused by the rule it names, and `ruleCoverage.unit.test.ts`
 * reads the same field to prove no governed rule is left without a test.
 *
 * The 256 KiB specification is deliberately absent — a checked-in file that
 * large is a repository cost with no reading value, so the size ceiling is
 * exercised from a generated specification in `vegaLiteLimits.unit.test.ts`.
 */

import type { GovernedVegaRuleId } from "~/features/analytics-query/visualization/visualization.types";

import callerSuppliedDatasets from "./caller-supplied-datasets.json";
import configMarkUrl from "./config-mark-url.json";
import dataUrlAtTop from "./data-url-at-top.json";
import dataUrlNestedFiveDeep from "./data-url-nested-five-deep.json";
import deepNestingPastCeiling from "./deep-nesting-past-ceiling.json";
import expressionForbiddenIdentifier from "./expression-forbidden-identifier.json";
import expressionForbiddenLabelExpr from "./expression-forbidden-label-expr.json";
import imageMark from "./image-mark.json";
import imageMarkNested from "./image-mark-nested.json";
import inlineDataValues from "./inline-data-values.json";
import interactiveParamsPastCeiling from "./interactive-params-past-ceiling.json";
import layersPastCeiling from "./layers-past-ceiling.json";
import lookupFromDataUrl from "./lookup-from-data-url.json";
import lookupFromDataValues from "./lookup-from-data-values.json";
import repeatPastUnitViewCeiling from "./repeat-past-unit-view-ceiling.json";
import singleExpressionPastCeiling from "./single-expression-past-ceiling.json";
import totalExpressionsPastCeiling from "./total-expressions-past-ceiling.json";
import transformsPastCeiling from "./transforms-past-ceiling.json";
import unitViewsPastCeiling from "./unit-views-past-ceiling.json";
import unknownTransform from "./unknown-transform.json";
import unresolvedDataset from "./unresolved-dataset.json";
import urlEncodingChannel from "./url-encoding-channel.json";
import usermetaConfigUrlString from "./usermeta-config-url-string.json";
import usermetaEmbedOptions from "./usermeta-embed-options.json";

export interface AdversarialVegaFixture {
  readonly name: string;
  /** The rule that must refuse this fixture. */
  readonly attacks: GovernedVegaRuleId;
  readonly spec: unknown;
}

export const ADVERSARIAL_VEGA_FIXTURES: readonly AdversarialVegaFixture[] = [
  // Composition and cost.
  {
    name: "deep-nesting-past-ceiling",
    attacks: "limit.maxNestingDepth",
    spec: deepNestingPastCeiling,
  },
  {
    name: "unit-views-past-ceiling",
    attacks: "limit.maxUnitViews",
    spec: unitViewsPastCeiling,
  },
  {
    name: "repeat-past-unit-view-ceiling",
    attacks: "limit.maxUnitViews",
    spec: repeatPastUnitViewCeiling,
  },
  {
    name: "layers-past-ceiling",
    attacks: "limit.maxLayersPerView",
    spec: layersPastCeiling,
  },
  {
    name: "transforms-past-ceiling",
    attacks: "limit.maxTransforms",
    spec: transformsPastCeiling,
  },
  {
    name: "single-expression-past-ceiling",
    attacks: "limit.maxExpressionBytes",
    spec: singleExpressionPastCeiling,
  },
  {
    name: "total-expressions-past-ceiling",
    attacks: "limit.maxTotalExpressionBytes",
    spec: totalExpressionsPastCeiling,
  },
  {
    name: "interactive-params-past-ceiling",
    attacks: "limit.maxInteractiveParams",
    spec: interactiveParamsPastCeiling,
  },

  // Data that did not come from the governed query.
  {
    name: "inline-data-values",
    attacks: "data.inline-values",
    spec: inlineDataValues,
  },
  {
    name: "caller-supplied-datasets",
    attacks: "data.caller-datasets",
    spec: callerSuppliedDatasets,
  },
  {
    name: "unresolved-dataset",
    attacks: "data.unresolved",
    spec: unresolvedDataset,
  },

  // Resource loading, at the top and buried in the composition tree.
  { name: "data-url-at-top", attacks: "data.url", spec: dataUrlAtTop },
  {
    name: "data-url-nested-five-deep",
    attacks: "data.url",
    spec: dataUrlNestedFiveDeep,
  },
  {
    name: "lookup-from-data-url",
    attacks: "lookup.url-data",
    spec: lookupFromDataUrl,
  },
  {
    name: "lookup-from-data-values",
    attacks: "lookup.inline-data",
    spec: lookupFromDataValues,
  },
  { name: "image-mark", attacks: "mark.image", spec: imageMark },
  { name: "image-mark-nested", attacks: "mark.image", spec: imageMarkNested },
  {
    name: "url-encoding-channel",
    attacks: "encoding.url",
    spec: urlEncodingChannel,
  },
  {
    name: "config-mark-url",
    attacks: "resource.url-property",
    spec: configMarkUrl,
  },
  {
    name: "usermeta-config-url-string",
    attacks: "resource.url-property",
    spec: usermetaConfigUrlString,
  },

  // Taking over the chart runtime, or the expression evaluator.
  {
    name: "usermeta-embed-options",
    attacks: "runtime.embed-options",
    spec: usermetaEmbedOptions,
  },
  {
    name: "unknown-transform",
    attacks: "transform.unknown",
    spec: unknownTransform,
  },
  {
    name: "expression-forbidden-identifier",
    attacks: "expression.forbidden",
    spec: expressionForbiddenIdentifier,
  },
  // An expression under a tick label is still an expression: `labelExpr` is
  // evaluated like any other, so it is screened like any other.
  {
    name: "expression-forbidden-label-expr",
    attacks: "expression.forbidden",
    spec: expressionForbiddenLabelExpr,
  },
];
