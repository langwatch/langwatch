/** @see specs/instant-evals/instant-eval-billing.feature */

export interface SpendKeyLabelInput {
  row: { virtualKeyId: string; requestType: string };
  virtualKeyName: string | undefined;
}

/**
 * A spend row without a virtual key names the request type instead; an
 * instant eval judgment carries no key of its own.
 */
export function spendKeyLabel({ row, virtualKeyName }: SpendKeyLabelInput): string {
  if (!row.virtualKeyId && row.requestType === "instant_eval") {
    return "Instant Evals";
  }
  return virtualKeyName ?? row.virtualKeyId;
}
