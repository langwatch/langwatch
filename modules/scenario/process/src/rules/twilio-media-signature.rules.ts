import { createHmac, timingSafeEqual } from "node:crypto";

/** The URL the scenario SDK puts in `<Stream url>` for `nonce`, from the worker's public origin. */
export function twilioMediaStreamUrl(input: { publicBaseUrl: string; nonce: string }): string {
  const base = input.publicBaseUrl
    .replace(/^https:/, "wss:")
    .replace(/^http:/, "ws:")
    .replace(/\/$/, "");
  return `${base}/twilio/${input.nonce}`;
}

/**
 * Whether `signature` is Twilio's X-Twilio-Signature for `streamUrl`: base64 HMAC-SHA1 under
 * the account's auth token. An upgrade has no form body, so the URL is all that is signed; its
 * https spelling is accepted beside the wss one the call was placed with.
 */
export function isTwilioMediaSignatureValid(input: {
  authToken: string;
  streamUrl: string;
  signature: string | readonly string[] | undefined;
}): boolean {
  if (typeof input.signature !== "string" || input.signature.length === 0) return false;
  const received = Buffer.from(input.signature, "base64");
  const spellings = [
    input.streamUrl,
    input.streamUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:"),
  ];

  return spellings.some((url) => {
    const expected = createHmac("sha1", input.authToken).update(url).digest();
    return expected.length === received.length && timingSafeEqual(expected, received);
  });
}
