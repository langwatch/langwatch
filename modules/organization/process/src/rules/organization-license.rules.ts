import { createHash } from "node:crypto";

/** The sha256 hex licensing's licence-stored fact names a key by (C3-KEY-HASH). */
export function fingerprintOfLicenseKey(licenseKey: string): string {
  return createHash("sha256").update(licenseKey).digest("hex");
}
