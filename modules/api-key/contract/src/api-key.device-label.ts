/**
 * The device label a CLI device session is known by on its ApiKey rows. One
 * derivation serves the login key and every ingest key minted under it, kept
 * pure and dependency-free so two consumers derive the same label without a cyclic import.
 */

/** The device label stamped when an older CLI sends no client_info. */
export const CLI_LOGIN_UNKNOWN_DEVICE_LABEL = "unknown-device";

/** The subset of a session's client_info a label is derived from. */
export interface DeviceLabelSource {
  device_label?: string | null;
  hostname?: string | null;
}

/**
 * Reduce a free-form device label to the charset a key name carries. Returns
 * null when nothing usable survives, so a caller can fall back to something
 * other than naming every machine the same.
 */
export function normalizeDeviceLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .slice(0, 24)
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * The label for a device session: the user-chosen label wins over the
 * machine hostname, both normalized, else `unknown-device`. It also
 * matches the previous login key on re-login, so it must stay normalized.
 */
export function deviceLabelForSession(clientInfo: DeviceLabelSource | undefined | null): string {
  return (
    normalizeDeviceLabel(clientInfo?.device_label ?? clientInfo?.hostname) ??
    CLI_LOGIN_UNKNOWN_DEVICE_LABEL
  );
}
