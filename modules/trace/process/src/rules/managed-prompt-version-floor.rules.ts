/**
 * Where trace_analytics' `LastUsedPromptVersionId` is known from, read off the managed prompt
 * version replay's ledger row (analytics ADR-006).
 * @see specs/lwql/stock-widgets-on-trace-metrics.feature
 */
import type { TraceManagedPromptVersionFloor } from "@langwatch/trace-contract";
import type { LedgerStepRecord } from "@langwatch/upgrade/reader";
import { projectionReplaySinceOf } from "@langwatch/upgrade/step";

/** The floor when the ledger cannot say: never the rows, never "rebuilding". */
export const MANAGED_PROMPT_VERSION_HISTORY_UNKNOWN: Readonly<TraceManagedPromptVersionFloor> =
  Object.freeze({ from: null, rebuilding: false, unknown: true });

/**
 * Only a done replay's recorded since is a floor: until then older rows read '' and a widget's
 * rows would be wrong. A failed replay, or a done one with no since, is unknown; a fresh install
 * (not needed) is whole.
 */
export function managedPromptVersionFloorOf(
  records: readonly LedgerStepRecord[],
): TraceManagedPromptVersionFloor {
  const [record] = records;
  if (record?.status === "not-needed") return { from: null, rebuilding: false, unknown: false };
  if (record?.status === "failed") return MANAGED_PROMPT_VERSION_HISTORY_UNKNOWN;
  if (!record || record.status !== "done") return { from: null, rebuilding: true, unknown: false };
  const since = projectionReplaySinceOf(record.report);
  if (since === null) return MANAGED_PROMPT_VERSION_HISTORY_UNKNOWN;
  return { from: since, rebuilding: false, unknown: false };
}
