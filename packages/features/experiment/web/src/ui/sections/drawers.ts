/**
 * The URL-addressed drawers this family owns.
 *
 * ONE PUBLIC ENTRY FOR THE WHOLE SET, the shape `./screens/experiments` keeps
 * for the pages and the shape `@langwatch/evaluator-web/drawers` established:
 * the composing application spreads a map of these into its drawer registry, so
 * what it may name is one entry rather than a path per component.
 *
 * BOTH OF THESE CAME BACK FROM `platform/app`, deleted in `cc91631cd8` and
 * recorded in `dev/docs/plans/ownerless-ui-surfaces-census.md` as group (c) —
 * addressed by a live screen, answered by nothing. `targetTypeSelector` is what
 * the Evaluations v3 table's "+" and the Run Evaluation button open;
 * `comparisonLeaderboard` is what the leaderboard card's expand affordance
 * opens. Neither is application chrome: every card, panel, chart and type they
 * compose was already this package's.
 */

export {
  ComparisonLeaderboardDrawer,
  type ComparisonLeaderboardDrawerProps,
} from "./batch-results/comparison-leaderboard-drawer";
export {
  TargetTypeSelectorDrawer,
  type TargetTypeSelectorDrawerProps,
} from "./experiments-v3/target-type-selector-drawer";
