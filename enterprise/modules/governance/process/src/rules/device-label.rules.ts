// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Reduce a free-form device label to the charset a key name carries. Returns
 * null when nothing usable survives, so the caller falls back to a random
 * suffix rather than naming every machine the same.
 */
export function findDeviceLabel(raw: string | undefined | null): string | null {
  if (!raw) return null;

  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .slice(0, 24)
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return cleaned.length > 0 ? cleaned : null;
}
