/**
 * Essential or Strict for the whole organization, what each stores and what Strict costs.
 * Strict is the LangWatch PII Redaction Model. Spec:
 * modules/data-privacy/specs/pii-redaction-level-picker.feature
 */

import type {
  DataPrivacyConfig,
  DataPrivacyRule,
  PiiLevel,
} from "@langwatch/data-privacy-contract";
import { PII_REDACTION_NANO_USD_PER_CHARACTER } from "@langwatch/data-privacy-contract/pii-redaction-spend";

/** The two levels the organization picker offers. */
export type OrganizationPiiLevel = "essential" | "strict";

export const PII_REDACTION_MODEL_NAME = "LangWatch PII Redaction Model";

const NANO_USD_PER_USD = 1_000_000_000;
const PRICE_UNIT_CHARACTERS = 1_000_000;

/** "$0.50": the rate billing charges, per 1M characters (ADR-201). */
export function piiRedactionModelPrice({
  nanoUsdPerCharacter,
}: {
  nanoUsdPerCharacter: number;
}): string {
  const usd = (nanoUsdPerCharacter * PRICE_UNIT_CHARACTERS) / NANO_USD_PER_USD;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(usd);
}

export const PII_REDACTION_MODEL_PRICE = `${piiRedactionModelPrice({
  nanoUsdPerCharacter: PII_REDACTION_NANO_USD_PER_CHARACTER,
})} per 1M characters`;

export const STRICT_BILLING_NOTE =
  "Pay as you go, no quota or plan. Only Strict spans are billed; Essential stays included.";
export const STRICT_FALLBACK_NOTE =
  "Strict falls back to the standard detector for a span when the model is unavailable or the span is over 8,000 characters.";

export const ESSENTIAL_FINDS = "Emails, phones, cards, IPs and national IDs";
export const ESSENTIAL_MISSES = "Does not find names or street addresses";
export const STRICT_GAPS =
  "Some city and country names, and dates of birth. Code fields named like personal data (a variable called email) can be masked when they should not be. Exceptions in each rule still apply.";

/** The level the organization picker shows, or null when it is Off or Custom. */
export function organizationPiiLevel(level: PiiLevel | undefined): OrganizationPiiLevel | null {
  return level === "essential" || level === "strict" ? level : null;
}

/** The organization's own rule, if it has one. */
export function organizationRule({
  rules,
  organizationId,
}: {
  rules: readonly DataPrivacyRule[];
  organizationId: string;
}): DataPrivacyRule | null {
  return (
    rules.find(
      (rule) =>
        rule.scopeType === "ORGANIZATION" && rule.scopeId === organizationId && !rule.personalOnly,
    ) ?? null
  );
}

/** The organization rule at a new PII level; its exceptions and every other field are kept. */
export function withOrganizationPiiLevel({
  config,
  level,
}: {
  config: DataPrivacyConfig;
  level: OrganizationPiiLevel;
}): DataPrivacyConfig {
  const exceptPatterns = config.pii?.exceptPatterns ?? [];
  return {
    ...config,
    pii: { level, ...(exceptPatterns.length > 0 ? { exceptPatterns: [...exceptPatterns] } : {}) },
  };
}

/** One piece of the synthetic example: plain text, a masked value, or a value stored as sent. */
export type ExampleToken =
  | { kind: "text"; text: string }
  | { kind: "masked"; label: string }
  | { kind: "kept"; text: string };

const text = (value: string): ExampleToken => ({ kind: "text", text: value });
const masked = (label: string): ExampleToken => ({ kind: "masked", label });
const kept = (value: string): ExampleToken => ({ kind: "kept", text: value });

export const EXAMPLE_SENT =
  "Hi, this is Daniel Okafor. Please send the replacement to 42 Larkspur Lane, Apt 7, Springfield. You can reach me at daniel.okafor@example.com or +1 541 555 0137.";

/** The same synthetic span as each level stores it. */
export const EXAMPLE_STORED: Record<OrganizationPiiLevel, ExampleToken[]> = {
  essential: [
    text("Hi, this is "),
    kept("Daniel Okafor"),
    text(". Please send the replacement to "),
    kept("42 Larkspur Lane, Apt 7, Springfield"),
    text(". You can reach me at "),
    masked("EMAIL"),
    text(" or "),
    masked("PHONE"),
    text("."),
  ],
  strict: [
    text("Hi, this is "),
    masked("NAME"),
    text(". Please send the replacement to "),
    masked("ADDRESS"),
    text(". You can reach me at "),
    masked("EMAIL"),
    text(" or "),
    masked("PHONE"),
    text("."),
  ],
};
