/**
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 * @see modules/data-privacy/specs/pii-redaction-billing.feature
 */

export interface SpendKeyLabelInput {
  row: { virtualKeyId: string; requestType: string };
  virtualKeyName: string | undefined;
}

/** The label of each request type whose spend rows carry no virtual key of their own. */
const KEYLESS_REQUEST_TYPE_LABELS: ReadonlyMap<string, string> = new Map([
  ["instant_eval", "Instant Evals"],
  ["instant_eval_decision_model", "Own model"],
  ["pii_redaction", "PII redaction"],
]);

/**
 * A spend row without a virtual key names the request type instead; an
 * instant eval judgment, a judgment on an organization's own decision model and a PII
 * redaction model call carry no key of their own.
 */
export function spendKeyLabel({ row, virtualKeyName }: SpendKeyLabelInput): string {
  if (!row.virtualKeyId) {
    const label = KEYLESS_REQUEST_TYPE_LABELS.get(row.requestType);
    if (label) return label;
  }
  return virtualKeyName ?? row.virtualKeyId;
}
