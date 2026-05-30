const DISCOVERY_TIMEOUT_MS = 5000;
const REQUIRED_FIELDS = [
  "authorization_endpoint",
  "token_endpoint",
  "jwks_uri",
  "issuer",
] as const;

export type OidcDiscoveryResult =
  | { valid: true; issuer: string }
  | { valid: false; error: string };

export async function validateOidcDiscovery({
  issuerUrl,
}: {
  issuerUrl: string;
}): Promise<OidcDiscoveryResult> {
  const normalizedIssuer = issuerUrl.replace(/\/+$/, "");
  const discoveryUrl = `${normalizedIssuer}/.well-known/openid-configuration`;

  let parsed: URL;
  try {
    parsed = new URL(discoveryUrl);
  } catch {
    return { valid: false, error: "Invalid issuer URL" };
  }

  if (parsed.protocol !== "https:") {
    return { valid: false, error: "Issuer URL must use HTTPS" };
  }

  // SSRF defense: block private/loopback addresses
  if (
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "::1" ||
    parsed.hostname.endsWith(".local") ||
    parsed.hostname.startsWith("10.") ||
    parsed.hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(parsed.hostname)
  ) {
    return { valid: false, error: "Issuer URL must not point to a private network" };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);

    const response = await fetch(discoveryUrl, {
      signal: controller.signal,
      redirect: "error",
      headers: { Accept: "application/json" },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        valid: false,
        error: `Discovery endpoint returned ${response.status}`,
      };
    }

    const config = (await response.json()) as Record<string, unknown>;

    for (const field of REQUIRED_FIELDS) {
      if (typeof config[field] !== "string" || !config[field]) {
        return {
          valid: false,
          error: `Missing required field: ${field}`,
        };
      }
    }

    const discoveredIssuer = config.issuer as string;
    if (discoveredIssuer.replace(/\/+$/, "") !== normalizedIssuer) {
      return {
        valid: false,
        error: `Issuer mismatch: expected ${normalizedIssuer}, got ${discoveredIssuer}`,
      };
    }

    return { valid: true, issuer: discoveredIssuer };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { valid: false, error: "Discovery request timed out (5s)" };
    }
    if (error instanceof TypeError && String(error).includes("redirect")) {
      return { valid: false, error: "Discovery endpoint returned a redirect" };
    }
    return {
      valid: false,
      error: `Failed to fetch discovery document: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}
