// gitleaks:allow — local-dev and test-suite enterprise licenses, not real secrets
import { createVerify } from "node:crypto";

import { signedLicenseSchema, type SignedLicense } from "@langwatch/enterprise-licensing-contract";

/** Signed for the default license key: a fresh local install boots as enterprise. */
export const LOCAL_DEV_ENTERPRISE_LICENSE_KEY =
  "eyJkYXRhIjp7ImxpY2Vuc2VJZCI6ImxpYy1kNmYwZjIwYy1mMWY5LTQ0ODktYmMwYS03N2IxNTY5ODZiMGMiLCJ2ZXJzaW9uIjoxLCJvcmdhbml6YXRpb25OYW1lIjoiQWNtZSBDb3JwIiwiZW1haWwiOiJhZG1pbkBhY21lLmNvcnAiLCJpc3N1ZWRBdCI6IjIwMjYtMDctMzFUMTU6MzE6NDkuOTA0WiIsImV4cGlyZXNBdCI6IjIwMjctMDctMzFUMTU6MzE6NDkuOTA0WiIsInBsYW4iOnsidHlwZSI6IkVOVEVSUFJJU0UiLCJuYW1lIjoiRW50ZXJwcmlzZSIsIm1heE1lbWJlcnMiOjEwMCwibWF4TWVtYmVyc0xpdGUiOjUwLCJtYXhUZWFtcyI6MTAwLCJtYXhQcm9qZWN0cyI6NTAwLCJtYXhNZXNzYWdlc1Blck1vbnRoIjoxMDAwMDAwMCwiZXZhbHVhdGlvbnNDcmVkaXQiOjAsIm1heFdvcmtmbG93cyI6MTAwMCwibWF4UHJvbXB0cyI6MTAwMCwibWF4RXZhbHVhdG9ycyI6MTAwMCwibWF4U2NlbmFyaW9zIjoxMDAwLCJtYXhBZ2VudHMiOjEwMDAsIm1heEV4cGVyaW1lbnRzIjoxMDAwLCJtYXhPbmxpbmVFdmFsdWF0aW9ucyI6MTAwMCwibWF4RGF0YXNldHMiOjEwMDAsIm1heERhc2hib2FyZHMiOjEwMDAsIm1heEN1c3RvbUdyYXBocyI6MTAwMCwibWF4QXV0b21hdGlvbnMiOjEwMDAsImNhblB1Ymxpc2giOnRydWUsIndlYmhvb2tFbmRwb2ludHNFbmFibGVkIjp0cnVlLCJ1c2FnZVVuaXQiOiJ0cmFjZXMifX0sInNpZ25hdHVyZSI6IlQ1ZG9ZdFh2dGxZWlNBaEVVRHJZQzhBdkFqWitDeVc2d0EzTURkWXNGcktuVStINkhTNVJXMXBUUmZ5cmFLWll1MHdYL1JLRzFVNGVjMEg5a05LaXFzdDlhaVBxTTBFSWxUYlB2RllJSEZRd2NCK2t3Q3RjRDc0VmsvVW92U1h1VUpDM2ozUWpnazhQMlNCWWlnZUd4MU83SVpYR0k1L1VBV0p0YmpPT04wSitOZmFaUE8vM2lmN1lMOWpscHNwY2FqYjlrbjU4U0k0VlBNV0VuL05Tell6ZzVYcVRrZmpJNnIxK1JSTzFKR0gyT1RlUHZSU0IvR01JWlYrbEczYlVkcW5iRjFlM3dtNVBKMUVQRzVqWDFmREZPNkM1OHlSb1BpQ0NGZ3ZOTzhtaWZZa0ZodjlxQTQwOGtUdE4rQjM3Uk0yOXdINHhZbmd5UFZNNUtoNXE1UT09In0=";

/** The licensing test suite's enterprise fixture, signed for the test key CI seeds boot with. */
export const TEST_SUITE_ENTERPRISE_LICENSE_KEY =
  "eyJkYXRhIjp7ImxpY2Vuc2VJZCI6ImxpYy0wMDEiLCJ2ZXJzaW9uIjoxLCJvcmdhbml6YXRpb25OYW1lIjoiQWNtZSBDb3JwIiwiZW1haWwiOiJhZG1pbkBhY21lLmNvcnAiLCJpc3N1ZWRBdCI6IjIwMjQtMDEtMDFUMDA6MDA6MDBaIiwiZXhwaXJlc0F0IjoiMjAzMC0xMi0zMVQyMzo1OTo1OVoiLCJwbGFuIjp7InR5cGUiOiJFTlRFUlBSSVNFIiwibmFtZSI6IkVudGVycHJpc2UiLCJtYXhNZW1iZXJzIjoxMDAsIm1heFByb2plY3RzIjo1MDAsIm1heE1lc3NhZ2VzUGVyTW9udGgiOjEwMDAwMDAwLCJldmFsdWF0aW9uc0NyZWRpdCI6MTAwMDAsIm1heFdvcmtmbG93cyI6MTAwMCwibWF4UHJvbXB0cyI6MTAwMCwibWF4RXZhbHVhdG9ycyI6MTAwMCwibWF4U2NlbmFyaW9zIjoxMDAwLCJtYXhBZ2VudHMiOjEwMDAsIm1heEV4cGVyaW1lbnRzIjoxMDAwLCJtYXhPbmxpbmVFdmFsdWF0aW9ucyI6MTAwMCwiY2FuUHVibGlzaCI6dHJ1ZX19LCJzaWduYXR1cmUiOiJhRDlLVkx0V2JOT3pGc3JrOUxHQzdhWEZRdk41MDVBR1VHSWVpcXN5S0tYM1IzK3o1aXIrV01lTS9tQVovOVBOeGRDalUrODVLS3A4TFAweDhIcWl0YnRubVprNVhqQ29uNWQ3S1Q3WFhwOWtsd2tEV0VocnNuL2F5ZWlYcWw0eElzUWZMNG92QitaZEt3TFVQUVFucWFGUVhFU093WEt2akp4QzU0VFp6bUk4THBXbSthYk10Qm50VFNxaFVaamRMdkJJWTlVbHR6LzU2T3pvUmgvdlJuSXhleUdlVkJCK3pWaVQ3LzF6YkpGMG5QZ1ZhVW9GUHI1dFRGYzRvS1VPdXRJSjRyWVJPSkFQNUlUbjZ4OHJLSDBXNi9QSmNVeWlHUE9TL085UXhCVXhGWml0Y3R6UDlwZURGeGhxcm5wbGxUdE1iVER6SVprS3gyMWFadDJMRUE9PSJ9";

function parseLicenseKey(licenseKey: string): SignedLicense | undefined {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(licenseKey, "base64").toString("utf-8"));
    const result = signedLicenseSchema.safeParse(decoded);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/** The licensing module's check: an RSA-SHA256 signature over the license data's JSON. */
export function isSignedFor({
  licenseKey,
  publicKey,
}: {
  licenseKey: string;
  publicKey: string;
}): boolean {
  const signed = parseLicenseKey(licenseKey);
  if (!signed?.signature.trim()) return false;
  try {
    const verify = createVerify("SHA256");
    verify.update(JSON.stringify(signed.data));
    verify.end();
    return verify.verify(publicKey, signed.signature, "base64");
  } catch {
    return false;
  }
}

/**
 * Picks the license to seed: keeps a stored one that verifies against the boot key (never
 * clobbering a hand-activated license), else the first candidate that verifies, else the first.
 */
export function resolveSeedLicense({
  stored,
  publicKey,
  candidates,
}: {
  stored: string | null;
  publicKey: string;
  candidates: readonly [string, ...string[]];
}): string {
  if (stored && isSignedFor({ licenseKey: stored, publicKey })) return stored;
  return candidates.find((licenseKey) => isSignedFor({ licenseKey, publicKey })) ?? candidates[0];
}
