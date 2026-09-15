import { uppercaseFirstLetter } from "./string-casing.ts";

/**
 * Display naming for the group-by bucket of a chart series.
 *
 * This was a chain of `.replace()` calls applied to an already-composed
 * sentence, so reading it meant reconstructing which sentence each
 * replacement was aimed at, and nothing covered it. It is a pure function
 * here so the cases can be stated once and tested.
 */

/**
 * `evaluations.evaluation_passed` buckets rows by verdict, and the names are query values, not
 * display copy. `unknown` reads wrong rendered literally ("Evaluation passed unknown"): it holds
 * three populations at once — score-only evaluators, still-processing, and errored — so the label
 * stays deliberately vague rather than naming just one. Splitting the bucket into its three real
 * populations is a separate backend fix (#5080); this is only the display-layer half.
 */
const VERDICT_LABELS: Record<string, string> = {
  passed: "Evaluation Passed",
  failed: "Evaluation Failed",
  unknown: "No verdict",
};

const GROUP_BY_WITH_VERDICT_LABELS = "evaluations.evaluation_passed";

/** Shown when a row carries no group value at all, rather than "undefined". */
export const MISSING_GROUP_KEY_LABEL = "unknown";

export interface SeriesGroupNameInput {
  /** The group-by field, for example `evaluations.evaluation_passed`. */
  groupBy: string | undefined;
  /** The bucket value for this series. `undefined` means "not grouped". */
  groupKey: string | undefined;
  /** The group's registry label, for example `Evaluation Passed`. */
  groupLabel: string | undefined;
  hideGroupLabel: boolean;
}

/**
 * The group fragment for a series, or `""` when the series is not grouped.
 *
 * Callers with a single series render this as the whole series name; callers
 * with several render it parenthesised after the series name.
 */
export const formatSeriesGroupName = ({
  groupBy,
  groupKey,
  groupLabel,
  hideGroupLabel,
}: SeriesGroupNameInput): string => {
  if (groupKey === undefined) return "";

  if (groupBy === GROUP_BY_WITH_VERDICT_LABELS) {
    // A row with no verdict at all belongs in the same bucket as one the
    // query labelled `unknown`, otherwise the generic path below rebuilds
    // exactly the "evaluation passed unknown" string this replaces.
    const verdict = VERDICT_LABELS[groupKey === "" ? "unknown" : groupKey];
    if (verdict) return verdict;
  }

  // An empty group key still names a bucket, so it is labelled rather than
  // dropped. The label prefix is omitted when it is unknown, because
  // `undefined + " "` used to render the string "undefined " in front of it.
  const key = groupKey === "" ? MISSING_GROUP_KEY_LABEL : groupKey;
  const prefix = hideGroupLabel || !groupLabel ? "" : `${groupLabel.toLowerCase()} `;

  return `${prefix}${key}`;
};

/**
 * The series name for a chart carrying exactly one series, where the group
 * fragment is the whole name.
 */
export const formatSingleSeriesName = (groupName: string): string => {
  if (!groupName) return "";
  return uppercaseFirstLetter(groupName)
    .replace("Contains error", "Traces")
    .replace(/^Evaluation label /i, "")
    .replace(/^Thumbs up\/down /i, "");
};
