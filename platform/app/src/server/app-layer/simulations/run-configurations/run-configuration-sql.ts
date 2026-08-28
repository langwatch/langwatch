/**
 * The expressions that read a configuration off a run row.
 *
 * Everything here lives in the run's metadata, which the fold projection wrote
 * from the queued command: the target type and reference id and the two
 * simulation models under the reserved `langwatch` key, the resolved run
 * parameters beside it. Nothing needs a new column and nothing needs a
 * migration.
 *
 * The run NOTE sits in the same blob and no expression here reads it. One
 * expression answers WHETHER a run carried one, which is a different question:
 * a run plan that takes a note opens its note field ready on the next run, and
 * the text itself changes every run.
 *
 * @see specs/features/agent-testing/run-configuration-history.feature
 */

import { LANGWATCH_METADATA } from "../result-atoms/atom-sql";

/** The target's type: `http`, `prompt`, `code` or `workflow`. */
export const TARGET_TYPE_EXPR = `JSONExtractString(${LANGWATCH_METADATA}, 'targetType')`;

/**
 * A target as one comparable string, `<type>:<referenceId>`.
 *
 * The same two fields the shared key recipe joins, in the same order, so the
 * pre-collapse this drives groups the rows the final key would group. The
 * final key is still taken in TypeScript from the shared function: this string
 * only decides how many rows leave the database.
 */
export const TARGET_PAIR_EXPR = `concat(${TARGET_TYPE_EXPR}, ':', JSONExtractString(${LANGWATCH_METADATA}, 'targetReferenceId'))`;

/**
 * The simulator model the plan was configured with, '' when it named none.
 *
 * A run recorded before the models were stamped extracts as '' too, which is
 * correct: both mean "no model was chosen" and both key the same way.
 */
export const SIMULATOR_MODEL_EXPR = `JSONExtractString(${LANGWATCH_METADATA}, 'simulatorModel')`;

/** The judge model the plan was configured with, '' when it named none. */
export const JUDGE_MODEL_EXPR = `JSONExtractString(${LANGWATCH_METADATA}, 'judgeModel')`;

/**
 * The resolved run parameters, as the raw JSON object they were stored as.
 *
 * Raw rather than a map read: the values are strings, numbers and booleans,
 * and re-typing them in SQL would lose which they were. A run with no
 * parameters extracts as the empty string.
 */
export const RUN_PARAMETERS_EXPR = `JSONExtractRaw(ifNull(Metadata, '{}'), 'parameters')`;

/**
 * Only runs the platform pointed at a target can be a configuration.
 *
 * A run pushed from an SDK or from CI carries no target, so the dialog has
 * nothing to offer back for it. Dropping those rows here also keeps the target
 * pair from ever reading as a bare ':'.
 */
export const HAS_TARGET_CLAUSE = `AND JSONExtractString(${LANGWATCH_METADATA}, 'targetReferenceId') != ''`;

/**
 * Whether the run carried a note, as 1 or 0. It never reads the note.
 *
 * A run plan that took a note last time takes one again, so the dialog opens
 * the note block expanded and empty. The text belongs to one run and is
 * carried over by nothing.
 */
export const HAS_NOTE_EXPR = `JSONExtractString(ifNull(Metadata, '{}'), 'note') != ''`;
