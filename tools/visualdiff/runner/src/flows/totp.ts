import { createHmac } from "node:crypto";

import type { Locator } from "playwright";

import type { Action } from "./context.ts";
import { argument } from "./context.ts";
import { type } from "./primitives.ts";
import { targetOf } from "./target.ts";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** base32Decode reads RFC 4648 base32, ignoring case, spaces, dashes and padding. */
export const base32Decode = (text: string): Buffer => {
  const bytes: number[] = [];
  let bits = 0;
  let acc = 0;
  for (const char of text.toUpperCase().replace(/[\s=-]/g, "")) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`"${char}" is not base32`);
    acc = (acc << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((acc >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

/** totpCode is RFC 6238 (SHA1, 30s step, 6 digits) for a base32 secret at a time in millis. */
export const totpCode = ({ secret, at }: { secret: string; at: number }): string => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0xf;
  const value = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, "0");
};

/** secretIn is the base32 secret in a shown text: an otpauth:// link's `secret`, else the text. */
export const secretIn = (text: string): string => {
  const trimmed = text.trim();
  return trimmed.startsWith("otpauth://")
    ? (new URL(trimmed).searchParams.get("secret") ?? "")
    : trimmed;
};

const shown = async (target: Locator): Promise<string> => {
  await target.waitFor({ state: "visible", timeout: 6000 });
  return target.evaluate(
    (node) =>
      node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
        ? node.value
        : (node.textContent ?? ""),
    undefined,
    { timeout: 6000 },
  );
};

/** EDGE_MILLIS is how close to a window's end a code is not worth sending: wait for the next. */
const EDGE_MILLIS = 1500;

/**
 * totp keeps the current code for a shared secret as `{as}` (default `{totpCode}`). The secret is
 * `secret`, else the text of the element named by `from` (test id) or `fromSelector`. With a
 * `testId`, `selector`, `label` or `placeholder` it also types the code (`submit: "true"` enters).
 */
export const totp: Action = async (context) => {
  const { args, side } = context;
  const from: Record<string, string> =
    args.fromSelector === undefined
      ? { testId: argument({ context, name: "from" }) }
      : { selector: args.fromSelector };
  const source =
    args.secret ?? secretIn(await shown(targetOf({ root: side.page, args: from }).first()));
  const left = 30_000 - (Date.now() % 30_000);
  if (left < EDGE_MILLIS) await side.page.waitForTimeout(left + 200);
  const code = totpCode({ secret: source, at: Date.now() });
  context.values[args.as ?? "totpCode"] = code;
  const typed = ["testId", "selector", "label", "placeholder"].some(
    (key) => args[key] !== undefined,
  );
  if (typed) await type({ ...context, args: { ...args, text: code } });
};
