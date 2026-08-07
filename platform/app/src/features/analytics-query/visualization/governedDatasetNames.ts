/**
 * The names a governed specification is allowed to read data from.
 *
 * Lives here rather than beside the component that registers the dataset
 * because two very different callers need the same name and only one of them
 * has a DOM: the chart mode registers the result under it, and the save path on
 * the server names it as the whole registry when it validates a specification
 * it holds no rows for.
 *
 * @see specs/analytics/governed-sql-workbench.feature
 * @see specs/analytics/governed-sql-saved-charts.feature
 */

/** The dataset name the workbench registers its query result under. */
export const GOVERNED_QUERY_RESULT_DATASET = "query_result";
