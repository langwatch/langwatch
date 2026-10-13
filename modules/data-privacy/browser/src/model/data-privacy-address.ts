/**
 * How a privacy rule is named in a URL: the two query parameters and the address they carry. Kept
 * out of the screen so `data-privacy.ts` can publish this vocabulary without statically importing a
 * screen it also loads lazily — that pair is what kept every screen in the browser's main chunk.
 */

import type { DataPrivacyRule } from "@langwatch/data-privacy-contract";

/** The query parameter the scope filter lives in. Unchanged from the page. */
export const PRIVACY_SCOPE_QUERY_KEY = "scope";

/** The query parameter that carries the open rule drawer. */
export const PRIVACY_RULE_QUERY_KEY = "rule";

/** The value `?rule=` takes for the add flow, which targets no rule yet. */
export const PRIVACY_RULE_NEW_VALUE = "new";

/** The address of one rule: its tier, its id, and whether it is the personal variant. */
export function privacyRuleAddress(rule: {
  scopeType: string;
  scopeId: string;
  personalOnly: boolean;
}): string {
  return `${rule.scopeType}:${rule.scopeId}:${String(rule.personalOnly)}`;
}

/**
 * The rule an address names, out of the rules the reader can see. Nothing
 * is fetched — the already-read snapshot carries every readable rule,
 * which is what lets this rebuild itself from a pasted link.
 */
export function privacyRuleForAddress(
  address: string | undefined,
  rules: readonly DataPrivacyRule[],
): DataPrivacyRule | null {
  if (!address || address === PRIVACY_RULE_NEW_VALUE) return null;
  return rules.find((rule) => privacyRuleAddress(rule) === address) ?? null;
}
