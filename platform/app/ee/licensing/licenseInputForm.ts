/**
 * Which of the two accepted forms a license value is.
 *
 * `LANGWATCH_LICENSE_KEY` and the Helm value `app.license.key` take either
 * one, and Settings > License uses it to route a value pasted under the other
 * option:
 *
 * - an activation code (`LW-XXXX-XXXX-XXXX-XXXX`), which this install redeems
 *   over HTTPS at connect.langwatch.ai for a signed license;
 * - a signed license key, the long base64 string, which works offline.
 *
 * The form is read from the shape alone, so the browser and the server agree
 * on it without either one parsing or verifying a license. Pure and free of
 * Node built-ins for that reason.
 */

import { normaliseActivationCode } from "./activation/activationCodeShape";

export type LicenseInputForm =
  | { form: "empty" }
  | { form: "activation_code"; code: string }
  | { form: "license_key"; licenseKey: string };

export function detectLicenseInputForm(
  value: string | null | undefined,
): LicenseInputForm {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return { form: "empty" };
  const code = normaliseActivationCode(trimmed);
  if (code) return { form: "activation_code", code };
  return { form: "license_key", licenseKey: trimmed };
}
