import { Config, type ConfigOf } from "@langwatch/config";
import { Secret } from "@langwatch/secrets/secret";
import { z } from "zod";

/** Where hosted services are called. */
export const CONNECT_DEFAULT_GATEWAY_ENDPOINT = "https://gateway.langwatch.ai";

/** Where a license registers itself and reads its own state. */
export const CONNECT_DEFAULT_LICENSE_ENDPOINT = "https://connect.langwatch.ai";

const HTTPS_ORIGIN = /^https:\/\//i;
const LOOPBACK_HTTP_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;

/** https, or plain http to a loopback host only: a license token travels on it. */
function isAcceptableConnectEndpoint(value: string): boolean {
  return HTTPS_ORIGIN.test(value) || LOOPBACK_HTTP_ORIGIN.test(value);
}

/** An exported blank reads as unset, so the hosted endpoint applies. */
const connectEndpoint = (name: string, fallback: string) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z
      .string()
      .url()
      .refine(isAcceptableConnectEndpoint, {
        message: `${name} must use https (http is accepted for a loopback host only)`,
      })
      .default(fallback),
  );

/**
 * `publicKey` absent is normal (embedded production key); blank refuses every
 * license. Connect has no switch that turns it on — the license decides —
 * and `connectDisabled` only ever overrides it downwards (ADR-156).
 */
export const licensingConfig = Config.define((c) => ({
  publicKey: c.env(
    "LANGWATCH_LICENSE_PUBLIC_KEY",
    z
      .string()
      .optional()
      .transform((value) => value?.trim() || void 0),
  ),
  connectDisabled: c.env("LANGWATCH_CONNECT_DISABLED", z.stringbool().optional()),
  connectGatewayEndpoint: c.env(
    "LANGWATCH_CONNECT_GATEWAY_ENDPOINT",
    connectEndpoint("LANGWATCH_CONNECT_GATEWAY_ENDPOINT", CONNECT_DEFAULT_GATEWAY_ENDPOINT),
  ),
  connectLicenseEndpoint: c.env(
    "LANGWATCH_CONNECT_LICENSE_ENDPOINT",
    connectEndpoint("LANGWATCH_CONNECT_LICENSE_ENDPOINT", CONNECT_DEFAULT_LICENSE_ENDPOINT),
  ),
  /** The identity an operator names instead of the one this install minted. */
  connectInstanceId: c.env(
    "LANGWATCH_CONNECT_INSTANCE_ID",
    z
      .string()
      .optional()
      .transform((value) => value?.trim() || void 0),
  ),
}));

export type LicensingServerConfig = ConfigOf<typeof licensingConfig>;

/**
 * The key the registry signs a license with (ADR-156). Never a config field:
 * the api resolves it through the secrets chain and injects the signer, so the
 * value travels as a constructed collaborator and not as configuration.
 */
export const licensingSecrets = {
  licensePrivateKey: Secret.load("LANGWATCH_LICENSE_PRIVATE_KEY", { optional: true }),
  /** The key this whole deployment is licensed by, where an operator set one. */
  instanceLicenseKey: Secret.load("LANGWATCH_LICENSE_KEY", { optional: true }),
} as const;
