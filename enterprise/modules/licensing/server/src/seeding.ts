// gitleaks:allow — local-dev enterprise license key, not a real secret
import { NodeLicenseCryptographyAdapter } from "./services/node-license-cryptography.service.ts";

/**
 * Local-dev enterprise license key for seed and dev-tooling scripts.
 *
 * A pre-generated ENTERPRISE license signed for the public key the app boots
 * with by default, used only to bootstrap a fresh local install with
 * enterprise features unlocked. It is intentionally NOT sourced from the
 * licensing test fixtures — fixtures are not a runtime dependency surface, and
 * rotating them must not break local seeding.
 */
export const LOCAL_DEV_ENTERPRISE_LICENSE_KEY =
  "eyJkYXRhIjp7ImxpY2Vuc2VJZCI6ImxpYy1kNmYwZjIwYy1mMWY5LTQ0ODktYmMwYS03N2IxNTY5ODZiMGMiLCJ2ZXJzaW9uIjoxLCJvcmdhbml6YXRpb25OYW1lIjoiQWNtZSBDb3JwIiwiZW1haWwiOiJhZG1pbkBhY21lLmNvcnAiLCJpc3N1ZWRBdCI6IjIwMjYtMDctMzFUMTU6MzE6NDkuOTA0WiIsImV4cGlyZXNBdCI6IjIwMjctMDctMzFUMTU6MzE6NDkuOTA0WiIsInBsYW4iOnsidHlwZSI6IkVOVEVSUFJJU0UiLCJuYW1lIjoiRW50ZXJwcmlzZSIsIm1heE1lbWJlcnMiOjEwMCwibWF4TWVtYmVyc0xpdGUiOjUwLCJtYXhUZWFtcyI6MTAwLCJtYXhQcm9qZWN0cyI6NTAwLCJtYXhNZXNzYWdlc1Blck1vbnRoIjoxMDAwMDAwMCwiZXZhbHVhdGlvbnNDcmVkaXQiOjAsIm1heFdvcmtmbG93cyI6MTAwMCwibWF4UHJvbXB0cyI6MTAwMCwibWF4RXZhbHVhdG9ycyI6MTAwMCwibWF4U2NlbmFyaW9zIjoxMDAwLCJtYXhBZ2VudHMiOjEwMDAsIm1heEV4cGVyaW1lbnRzIjoxMDAwLCJtYXhPbmxpbmVFdmFsdWF0aW9ucyI6MTAwMCwibWF4RGF0YXNldHMiOjEwMDAsIm1heERhc2hib2FyZHMiOjEwMDAsIm1heEN1c3RvbUdyYXBocyI6MTAwMCwibWF4QXV0b21hdGlvbnMiOjEwMDAsImNhblB1Ymxpc2giOnRydWUsIndlYmhvb2tFbmRwb2ludHNFbmFibGVkIjp0cnVlLCJ1c2FnZVVuaXQiOiJ0cmFjZXMifX0sInNpZ25hdHVyZSI6IlQ1ZG9ZdFh2dGxZWlNBaEVVRHJZQzhBdkFqWitDeVc2d0EzTURkWXNGcktuVStINkhTNVJXMXBUUmZ5cmFLWll1MHdYL1JLRzFVNGVjMEg5a05LaXFzdDlhaVBxTTBFSWxUYlB2RllJSEZRd2NCK2t3Q3RjRDc0VmsvVW92U1h1VUpDM2ozUWpnazhQMlNCWWlnZUd4MU83SVpYR0k1L1VBV0p0YmpPT04wSitOZmFaUE8vM2lmN1lMOWpscHNwY2FqYjlrbjU4U0k0VlBNV0VuL05Tell6ZzVYcVRrZmpJNnIxK1JSTzFKR0gyT1RlUHZSU0IvR01JWlYrbEczYlVkcW5iRjFlM3dtNVBKMUVQRzVqWDFmREZPNkM1OHlSb1BpQ0NGZ3ZOTzhtaWZZa0ZodjlxQTQwOGtUdE4rQjM3Uk0yOXdINHhZbmd5UFZNNUtoNXE1UT09In0=";

/**
 * Picks the license the seed writes for the local-dev organization.
 *
 * The seed runs on every `haven up` as an idempotent upsert, so it must never
 * clobber a license somebody activated by hand: a stored license that verifies
 * against the key the app boots with stays. Otherwise the first candidate that
 * verifies against that key wins. If nothing verifies, the first candidate is
 * written so the organization still has a readable license.
 */
export function resolveSeedLicense({
  stored,
  publicKey,
  candidates = [LOCAL_DEV_ENTERPRISE_LICENSE_KEY],
}: {
  stored: string | null;
  publicKey: string;
  candidates?: readonly [string, ...string[]];
}): string {
  // The cryptography adapter owns parsing and verification on this branch; the
  // monolith exposed them as free functions. Built once here rather than per
  // candidate, because it canonicalises the PEM on construction.
  const cryptography = NodeLicenseCryptographyAdapter.create({ publicKey });
  const signedForBootKey = (licenseKey: string): boolean => {
    const parsed = cryptography.tryParseLicenseKey(licenseKey);
    return parsed !== null && cryptography.verifySignature(parsed, publicKey);
  };

  if (stored && signedForBootKey(stored)) return stored;
  return candidates.find(signedForBootKey) ?? candidates[0];
}
