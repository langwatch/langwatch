/**
 * The classifier key the judge may use: LangWatch's own, on LangWatch Cloud only (ADR-174
 * decision 14). A self-hosted install that sets one gets no classifier, so it judges through
 * Connect or not at all. Self-hosted judging waits for wave 3.
 */
export type CloudClassifierKey = { available: true; apiKey: string } | { available: false };

export function cloudClassifierKeyOf({
  isCloud,
  apiKey,
}: {
  isCloud: boolean;
  apiKey: string | undefined;
}): CloudClassifierKey {
  return isCloud && apiKey ? { available: true, apiKey } : { available: false };
}
