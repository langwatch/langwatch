import { createHash, createHmac } from "node:crypto";

export const GATEWAY_SIGNATURE_WINDOW_SECONDS = 300;

/**
 * Build the canonical string the Go gateway signs:
 *   METHOD + "\n" + canonicalGatewayPath + "\n" + TIMESTAMP + "\n" + hex(sha256(body))
 */
export function buildGatewayCanonicalString(input: {
  method: string;
  path: string;
  timestamp: string;
  body: string;
}): string {
  const bodyHash = createHash("sha256").update(input.body).digest("hex");

  return `${input.method}\n${input.path}\n${input.timestamp}\n${bodyHash}`;
}

/**
 * The signed PATH line: the path, plus the query when there is one, its pairs
 * RFC 3986-encoded and sorted. Mirrors `CanonicalPath` in
 * services/aigateway/adapters/controlplane/signer.go.
 */
export function canonicalGatewayPath(url: URL): string {
  const pairs = [...url.searchParams].map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`);
  return pairs.length === 0 ? url.pathname : `${url.pathname}?${pairs.toSorted().join("&")}`;
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** hex(hmac_sha256(secret, canonical)) */
export function computeGatewaySignature(secret: string, canonical: string): string {
  return createHmac("sha256", secret).update(canonical).digest("hex");
}
