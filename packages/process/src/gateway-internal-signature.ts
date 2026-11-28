/**
 * The signature on the app and AI gateway internal channel, both ways (the gateway's side is
 * services/aigateway/adapters/httpapi/internal_middleware.go): HMAC-SHA256 over
 * METHOD, PATH, unix seconds and hex(sha256(body)), each on its own line.
 */
import { createHash, createHmac } from "node:crypto";

export const GATEWAY_SIGNATURE_HEADER = "X-LangWatch-Gateway-Signature";
export const GATEWAY_TIMESTAMP_HEADER = "X-LangWatch-Gateway-Timestamp";

/** hex(HMAC-SHA256) of one request at one timestamp, for a signer and a verifier alike. */
export function gatewayInternalSignature({
  secret,
  method,
  path,
  timestamp,
  body,
}: {
  secret: string;
  method: string;
  path: string;
  /** Unix seconds as written on the wire; a verifier passes the presented header verbatim. */
  timestamp: string;
  body: string;
}): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");

  return createHmac("sha256", secret)
    .update(`${method}\n${path}\n${timestamp}\n${bodyHash}`)
    .digest("hex");
}

/** The two headers that sign one request; a GET signs an empty body. */
export function gatewayInternalSignatureHeaders({
  secret,
  method,
  path,
  body = "",
  nowMs,
}: {
  secret: string;
  method: string;
  path: string;
  body?: string;
  nowMs: number;
}): Record<string, string> {
  const timestamp = Math.floor(nowMs / 1_000).toString();
  const signature = gatewayInternalSignature({ secret, method, path, timestamp, body });

  return { [GATEWAY_SIGNATURE_HEADER]: signature, [GATEWAY_TIMESTAMP_HEADER]: timestamp };
}
