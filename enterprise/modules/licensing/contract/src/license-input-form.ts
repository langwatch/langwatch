// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Which of the two accepted forms a license value is: an activation code
 * (`LW-XXXX-XXXX-XXXX-XXXX`, redeemed at connect.langwatch.ai) or a signed
 * license key (works offline). Read from the shape alone, so the License page
 * and `LANGWATCH_LICENSE_KEY` agree. Pure, so the browser can import it.
 * @see specs/licensing/configured-license-forms.feature
 */

/**
 * Crockford's base32 without I, L, O and U: the first three read as 1 and 0,
 * and the fourth is dropped so no code spells a word.
 */
export const ACTIVATION_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Four groups of four, which is short enough to read and dictate. */
export const ACTIVATION_CODE_GROUPS = 4;
export const ACTIVATION_CODE_GROUP_LENGTH = 4;

export const ACTIVATION_CODE_PREFIX = "LW";

/** Everything that is decoration rather than code: spaces and dashes. */
const DECORATION = /[\s-]+/g;

/** A normalised code: the prefix and sixteen characters of the alphabet. */
const NORMALISED_SHAPE = new RegExp(
  `^${ACTIVATION_CODE_PREFIX}[${ACTIVATION_CODE_ALPHABET}]{${
    ACTIVATION_CODE_GROUPS * ACTIVATION_CODE_GROUP_LENGTH
  }}$`,
);

export type LicenseInputForm =
  | { form: "empty" }
  | { form: "activation_code"; code: string }
  | { form: "license_key"; licenseKey: string };

/**
 * Case, spaces and dashes are decoration in a code, so a pasted code and a
 * dictated one are the same code; the answered `code` is the normalised one.
 */
export function detectLicenseInputForm(value: string | null | undefined): LicenseInputForm {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return { form: "empty" };
  const stripped = trimmed.replace(DECORATION, "").toUpperCase();
  if (NORMALISED_SHAPE.test(stripped)) return { form: "activation_code", code: stripped };
  return { form: "license_key", licenseKey: trimmed };
}
