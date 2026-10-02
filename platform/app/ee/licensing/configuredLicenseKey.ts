/**
 * The instance license configured through `LANGWATCH_LICENSE_KEY`, when it is a
 * signed license key.
 *
 * The variable also accepts an activation code. A code is not a license: it is
 * redeemed at boot and the license it returns is stored on the organization
 * (`configuredActivation.ts`), so the readers of the instance license only see
 * the variable when it holds the signed form.
 */

import { env } from "~/env.mjs";
import { detectLicenseInputForm } from "./licenseInputForm";

export function configuredSignedLicenseKey(): string | null {
  const input = detectLicenseInputForm(env.LANGWATCH_LICENSE_KEY);
  return input.form === "license_key" ? input.licenseKey : null;
}
