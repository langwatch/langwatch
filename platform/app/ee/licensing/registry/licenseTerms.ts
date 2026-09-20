/**
 * The commercial terms of a license, checked as they will stand after a change
 * rather than as they arrived (ADR-139).
 */

import { LicenseOverageMaxRequiresOverageError } from "./errors";
import type { IssuedLicenseRecord, LicenseTermsInput } from "./issuedLicense";

/**
 * An overage maximum is only valid while overage is enabled, and switching
 * overage off clears it.
 */
export function resolveLicenseTerms({
  current,
  input,
}: {
  current: IssuedLicenseRecord | null;
  input: LicenseTermsInput | undefined;
}): LicenseTermsInput {
  if (!input) return {};
  const overageEnabled =
    input.overageEnabled ?? current?.overageEnabled ?? false;

  if (!overageEnabled && input.overageMaxUsdCents != null) {
    throw new LicenseOverageMaxRequiresOverageError();
  }
  if (!overageEnabled && input.overageEnabled === false) {
    return { ...input, overageMaxUsdCents: null };
  }
  return input;
}
