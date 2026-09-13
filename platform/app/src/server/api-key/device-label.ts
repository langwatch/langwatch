/**
 * The device label a CLI device session is known by on its ApiKey rows.
 *
 * One derivation serves the CLI login key and every ingest key minted under
 * it, so the two carry the same label and the devices tab can show a key
 * beside the session that minted it.
 */

/** The device label stamped when an older CLI sends no client_info. */
export const CLI_LOGIN_UNKNOWN_DEVICE_LABEL = "unknown-device";

/** The subset of a session's client_info a label is derived from. */
export interface DeviceLabelSource {
  device_label?: string;
  hostname?: string;
}

/**
 * Reduce a free-form device label to the charset a key name carries. Returns
 * null when nothing usable survives, so a caller can fall back to something
 * other than naming every machine the same.
 */
export function sanitizeDeviceLabel(raw: string | undefined): string | null {
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
 * machine hostname, both normalized, and a session that sent neither is
 * `unknown-device`. The value names the login key AND matches the previous
 * login key for replacement on re-login, so an unnormalized value would leave
 * the old key alive on a hostname or formatting change.
 */
export function deviceLabelForSession(
  clientInfo: DeviceLabelSource | undefined,
): string {
  return (
    sanitizeDeviceLabel(clientInfo?.device_label ?? clientInfo?.hostname) ??
    CLI_LOGIN_UNKNOWN_DEVICE_LABEL
  );
}
