import { createHmac, timingSafeEqual } from "node:crypto";

const SCHEME_SPELLINGS: Record<string, readonly string[]> = {
  wss: ["wss", "https"],
  https: ["https", "wss"],
  ws: ["ws", "http"],
  http: ["http", "ws"],
};
const DEFAULT_PORT: Record<string, string> = { wss: "443", https: "443", ws: "80", http: "80" };
const URL_PARTS = /^(wss?|https?):\/\/([^/?#]+)([^?#]*)(.*)$/;

/**
 * Every spelling Twilio may have signed for a stream URL: wss or https (ws or http), with and
 * without a trailing slash, with and without the scheme's default port. The URL as given is first.
 */
export function twilioSignatureUrlVariants(url: string): string[] {
  const parts = URL_PARTS.exec(url);
  if (!parts) return [url];
  const [, scheme = "", authority = "", path = "", rest = ""] = parts;
  const host = authority.replace(/:\d+$/, "");
  const port = /:(\d+)$/.exec(authority)?.[1];
  const defaultPort = DEFAULT_PORT[scheme] ?? "";
  const authorities =
    port && port !== defaultPort ? [authority] : [authority, host, `${host}:${defaultPort}`];
  const slashed = path.endsWith("/") ? path.slice(0, -1) : `${path}/`;
  const variants = new Set([url]);
  for (const spelling of SCHEME_SPELLINGS[scheme] ?? []) {
    for (const candidate of authorities) {
      for (const candidatePath of [path, slashed]) {
        variants.add(`${spelling}://${candidate}${candidatePath}${rest}`);
      }
    }
  }
  return [...variants];
}

/**
 * Whether `signature` is Twilio's X-Twilio-Signature for `url`: base64 HMAC-SHA1 under the
 * account's auth token. An upgrade has no form body, so the URL is all that is signed.
 */
export function isValidTwilioSignature(input: {
  authToken: string;
  url: string;
  signature: string;
}): boolean {
  if (input.signature.length === 0) return false;
  const received = Buffer.from(input.signature, "base64");
  return twilioSignatureUrlVariants(input.url).some((variant) => {
    const expected = createHmac("sha1", input.authToken).update(variant).digest();
    return expected.length === received.length && timingSafeEqual(expected, received);
  });
}
