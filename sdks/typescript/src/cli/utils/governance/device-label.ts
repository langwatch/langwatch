import * as os from "node:os";

/**
 * A short, server-safe label naming this machine, attached to keys the
 * CLI mints (virtual keys, project ingest keys) so an admin revoking one
 * can tell which device it belongs to. Lowercased hostname, restricted
 * to [a-z0-9-], truncated; empty when the hostname yields nothing usable.
 */
export function deviceLabelForThisMachine(): string {
  const raw = os.hostname().toLowerCase();
  const cleaned = raw
    .replace(/\.(local|lan|home|localdomain)$/i, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 24);
}
