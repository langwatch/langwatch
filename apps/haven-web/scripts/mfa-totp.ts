/** RFC 6238 codes for `haven mfa totp`; the secret and codes stay in the daemon. */
import { createHmac } from "node:crypto";

export type Totp = { secret: string; algorithm: string; digits: number; period: number };

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** An otpauth:// URI or a bare base32 key (spaces and case ignored); undefined for neither. */
export function parseTotp({ raw }: { raw: string }): Totp | undefined {
  const text = raw.trim();
  let secret = text;
  let algorithm = "SHA1";
  let digits = 6;
  let period = 30;
  if (text.startsWith("otpauth://")) {
    const params = new URL(text).searchParams;
    secret = params.get("secret") ?? "";
    algorithm = (params.get("algorithm") ?? algorithm).toUpperCase();
    digits = Number(params.get("digits") ?? digits);
    period = Number(params.get("period") ?? period);
  }
  secret = secret.replace(/[\s=]/g, "").toUpperCase();
  if (!/^[A-Z2-7]{16,}$/.test(secret)) return undefined;
  if (!["SHA1", "SHA256", "SHA512"].includes(algorithm)) return undefined;
  return { secret, algorithm, digits, period };
}

function base32Bytes({ secret }: { secret: string }) {
  let bits = "";
  for (const char of secret) bits += BASE32.indexOf(char).toString(2).padStart(5, "0");
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((byte) => parseInt(byte, 2)));
}

/** The code for the time step `steps` periods away from now (0 is the current one). */
export function totpCode({ totp, now, steps = 0 }: { totp: Totp; now: number; steps?: number }) {
  const counter = Math.floor(now / 1000 / totp.period) + steps;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac(totp.algorithm.toLowerCase(), base32Bytes({ secret: totp.secret }))
    .update(message)
    .digest();
  const offset = (hmac.at(-1) ?? 0) & 0xf;
  const value = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 10 ** totp.digits).padStart(totp.digits, "0");
}

/** A well-formed code no verifier accepts: unlike the previous, current and next step's. */
export function wrongCode({ totp, now }: { totp: Totp; now: number }) {
  const accepted = new Set([-1, 0, 1].map((steps) => totpCode({ totp, now, steps })));
  let value = Number(totpCode({ totp, now })) + 1;
  for (;;) {
    const code = String(value % 10 ** totp.digits).padStart(totp.digits, "0");
    if (!accepted.has(code)) return code;
    value += 1;
  }
}

/** Every spelling of each secret a page shows (raw and grouped by four) replaced with ***. */
export function redactSecrets({ text, secrets }: { text: string; secrets: string[] }) {
  let out = text.replace(/otpauth:\/\/[^\s"'<>]+/g, "otpauth://***");
  for (const secret of secrets) {
    if (secret.length < 16) continue;
    const grouped = (secret.match(/.{1,4}/g) ?? []).join(" ");
    for (const form of [secret, grouped, secret.toLowerCase(), grouped.toLowerCase()])
      out = out.replaceAll(form, "***");
  }
  return out;
}
