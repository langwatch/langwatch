/**
 * The chaining, pre-done. A bare surface member call IS its default; a
 * deviating deployment imports the default and chains ON it, never rebuilding
 * one from parts and quietly dropping half the floor.
 */
import {
  ContentSecurityPolicy,
  storageConnectSources,
  type StorageEndpoints,
} from "./content-security-policy.ts";
import { SecurityHeaders } from "./security-headers.ts";

/** What every default needs to know about the deployment it is composed in. */
export type SurfaceDefaultsOptions = Readonly<{
  /**
   * Production enforces; development reports the same policy, so a directive
   * that would break production shows up as a console violation on the first
   * local run rather than after a deploy.
   */
  production?: boolean;
  /** The object-storage endpoints a direct upload reaches (ADR-032 R3). */
  storage?: StorageEndpoints | undefined;
  /** The origin serving content-hashed assets, where one is configured (ADR-086). */
  assetOrigin?: string | null | undefined;
}>;

/**
 * The tRPC surface's headers: the strict floor, plus the statement that an API
 * answer is never a document a browser should treat as one.
 */
export function trpcSurfaceDefaults(options: SurfaceDefaultsOptions = {}): SecurityHeaders {
  return SecurityHeaders.strict({ production: options.production === true }).with(
    "Cross-Origin-Resource-Policy",
    "same-origin",
  );
}

/** The REST surface's headers: the same floor and the same non-document statement. */
export function restSurfaceDefaults(options: SurfaceDefaultsOptions = {}): SecurityHeaders {
  return trpcSurfaceDefaults(options);
}

/**
 * The browser bundle's headers: the floor, the document policy composed from
 * this deployment's own storage and asset origins, and the permissions the
 * page actually uses.
 */
export function browserBundleDefaults(options: SurfaceDefaultsOptions = {}): SecurityHeaders {
  const production = options.production === true;

  return (
    SecurityHeaders.strict({ production })
      // The shell is framed by nothing, and the policy's own `frame-ancestors`
      // is the modern statement of it; the legacy header stays for the browsers
      // that only read that one.
      .withContentSecurityPolicy(
        ContentSecurityPolicy.app()
          .withConnectSource(...(options.storage ? storageConnectSources(options.storage) : []))
          .withAssetOrigin(options.assetOrigin ?? null)
          .upgradingInsecureRequests(production)
          .reportOnly(!production),
      )
      // microphone=(self): the voice panel captures audio on this origin.
      // microphone=() makes getUserMedia reject with NotAllowedError without
      // ever prompting, which reads to a person as a denial they never made (#7947).
      .with(
        "Permissions-Policy",
        "geolocation=(), microphone=(self), camera=(), payment=(), usb=()",
      )
  );
}
