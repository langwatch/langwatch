import { INSTANT_EVAL_REQUEST_TYPE } from "~/server/app-layer/instant-evals/spend/request-type";

/**
 * What the spend page's key column says for one row.
 *
 * A gateway request names the virtual key it was served under. An Instant
 * Eval judgement is served under no key at all, so the column would be blank
 * for exactly the rows a reader is least able to place; the request type is
 * what tells them apart, and the label names the feature.
 */
export function spendKeyLabel({
  row,
  virtualKeyName,
}: {
  row: { virtualKeyId: string; requestType: string };
  virtualKeyName: string | undefined;
}): string {
  if (row.requestType === INSTANT_EVAL_REQUEST_TYPE && !row.virtualKeyId) {
    return "Instant Evals";
  }
  return virtualKeyName ?? row.virtualKeyId;
}
