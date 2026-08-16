import { decrypt } from "~/utils/encryption";

/**
 * Reads a ModelProvider's `customKeys` column into a plain map.
 *
 * The column holds either an encrypted JSON string or, on rows written
 * before encryption, the object itself. A value that will not decrypt or
 * parse reads as no keys at all: a provider whose secrets cannot be read
 * serves nothing, and throwing here would take an unrelated request down
 * with it.
 */
export function decryptCustomKeys(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(decrypt(raw)) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}
