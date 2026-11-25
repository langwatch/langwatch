import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";

/** The CA a local LangWatch stack serves https with (the portless proxy writes it). */
export const PORTLESS_CA_PATH = join(homedir(), ".portless", "ca.pem");

const CERT_ERROR_CODES = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_ISSUER_CERT",
  "CERT_UNTRUSTED",
]);

/** True for `localhost` and any `*.localhost` host, the names a local stack answers on. */
export function isLocalDevHost(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, "");
  return name === "localhost" || name.endsWith(".localhost");
}

function hostOf(endpoint: string): string | undefined {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" ? url.hostname : undefined;
  } catch {
    return undefined;
  }
}

type TlsCaApi = Pick<typeof tls, "getCACertificates" | "setDefaultCACertificates">;

const trustedCas = new Set<string>();

export type LocalCaOutcome = "trusted" | "already-trusted" | "not-local" | "no-ca" | "unsupported";

/**
 * Adds the local stack CA to the trusted roots when the endpoint is an https
 * `localhost` host and the CA file exists. Verification stays on: only
 * certificates signed by that CA are newly accepted.
 */
export function trustLocalDevCa({
  endpoint,
  caPath = PORTLESS_CA_PATH,
  tlsApi = tls,
}: {
  endpoint: string;
  caPath?: string;
  tlsApi?: Partial<TlsCaApi>;
}): LocalCaOutcome {
  const host = hostOf(endpoint);
  if (!host || !isLocalDevHost(host)) return "not-local";
  if (trustedCas.has(caPath)) return "already-trusted";
  if (!existsSync(caPath)) return "no-ca";
  const { getCACertificates, setDefaultCACertificates } = tlsApi;
  if (typeof getCACertificates !== "function" || typeof setDefaultCACertificates !== "function") {
    return "unsupported";
  }
  const ca = readFileSync(caPath, "utf8");
  setDefaultCACertificates([...getCACertificates("default"), ca]);
  trustedCas.add(caPath);
  return "trusted";
}

function errorCodes(error: unknown): string[] {
  const codes: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") codes.push(code);
    current = (current as { cause?: unknown }).cause;
  }
  return codes;
}

/** True when a failed request was refused for an untrusted TLS certificate. */
export function isUntrustedCertError(error: unknown): boolean {
  return errorCodes(error).some((code) => CERT_ERROR_CODES.has(code));
}

/** The next step to print when a request failed on an untrusted certificate, else undefined. */
export function untrustedCertHint(error: unknown): string | undefined {
  if (!isUntrustedCertError(error)) return undefined;
  return "The server's TLS certificate is not trusted by Node. For a local stack, run again with NODE_EXTRA_CA_CERTS=~/.portless/ca.pem; otherwise point NODE_EXTRA_CA_CERTS at your CA bundle.";
}
