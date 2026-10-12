import { oneOf, type Rng } from "./rng.ts";

export const VALUE_FAMILIES = ["empty", "huge", "unicode", "bounds", "injection", "plain"] as const;
export type ValueFamily = (typeof VALUE_FAMILIES)[number];

export interface FuzzValue {
  family: ValueFamily;
  value: string;
}

const HUGE_LENGTH = 100_000;

const UNICODE = [
  "日本語のテキスト",
  "😀🏳️‍🌈👨‍👩‍👧‍👦",
  "مرحبا بالعالم",
  "Z̸̡̪͎a̷l̶g̵o̷",
  "‮reversed‬",
  "​‍﻿",
  "Ünïcödé ñ ß ø",
  "\u{1F4A9}".repeat(200),
];

const NUMBERS = [
  "0",
  "-0",
  "-1",
  "1",
  "0.1",
  "2147483647",
  "2147483648",
  "-2147483648",
  "9007199254740991",
  "9007199254740993",
  "1e308",
  "1e-324",
  "99999999999999999999",
];

const INJECTION = [
  "' OR 1=1 --",
  '"; DROP TABLE users; --',
  "<script>alert(1)</script>",
  '"><img src=x onerror=alert(1)>',
  "{{7*7}}",
  "${7*7}",
  "../../../../etc/passwd",
  "%s%s%s%n",
  "${jndi:ldap://127.0.0.1/a}",
  "\u0000",
  "null",
  "undefined",
  "__proto__",
  '{"$ne": null}',
];

const PLAIN = ["test", "Fuzz Name", "hello@example.com", "https://example.com", "42", "a b c"];

/** valueFor draws one value; a numeric field only ever gets numbers, which is all it accepts. */
export const valueFor = ({
  rng,
  numeric = false,
  family,
}: {
  rng: Rng;
  numeric?: boolean;
  family?: ValueFamily;
}): FuzzValue => {
  if (numeric) return { family: "bounds", value: oneOf({ rng, items: NUMBERS }) ?? "0" };
  const chosen = family ?? oneOf({ rng, items: VALUE_FAMILIES }) ?? "plain";
  switch (chosen) {
    case "empty":
      return { family: chosen, value: "" };
    case "huge":
      return { family: chosen, value: "A".repeat(HUGE_LENGTH) };
    case "unicode":
      return { family: chosen, value: oneOf({ rng, items: UNICODE }) ?? "" };
    case "bounds":
      return { family: chosen, value: oneOf({ rng, items: NUMBERS }) ?? "0" };
    case "injection":
      return { family: chosen, value: oneOf({ rng, items: INJECTION }) ?? "" };
    case "plain":
      return { family: chosen, value: oneOf({ rng, items: PLAIN }) ?? "" };
  }
};

/** preview is what a trail keeps of a value: the family and length, never 100 000 characters. */
export const preview = (value: FuzzValue): string =>
  `${value.family}(${value.value.length}):${JSON.stringify(value.value.slice(0, 30))}`;
