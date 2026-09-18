/**
 * Log redaction from what a process declared (§6): there is no central key
 * registry to ask any more, so a process states the handles it installed and
 * gets the paths for exactly those.
 */
import type { SecretHandle } from "./secret.ts";

/** What a redacted secret reads as. One spelling everywhere, so it greps. */
export const REDACTED = "[redacted]";

/**
 * The pino `redact` paths for a process's own declared handles: the id as a
 * top-level field, and the same name one level down, which is where a config
 * object logged by a boot line puts it.
 */
export function secretLogRedactPaths(
  declared: readonly SecretHandle<unknown>[],
): readonly string[] {
  const ids = [...new Set(declared.map((handle) => handle.id))];

  return ids.flatMap((id) => [id, `*.${id}`]);
}
