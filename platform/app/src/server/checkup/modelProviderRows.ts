import { readCustomKeys } from "~/server/modelProviders/customKeys";

/**
 * A model provider row as the checkup tests it: the `customKeys` column is
 * stored encrypted, so it is read through `readCustomKeys` before a key is
 * looked up in it. A row whose keys will not decrypt holds no keys and is
 * flagged `hasUnreadableKeys`, so the checkup names the decryption failure
 * instead of reporting a missing key.
 */
export function checkupModelProviderRow(row: {
  id: string;
  provider: string;
  customKeys: unknown;
}): {
  id: string;
  provider: string;
  customKeys: Record<string, string>;
  hasUnreadableKeys: boolean;
} {
  const read = readCustomKeys(row.customKeys);
  const customKeys: Record<string, string> = {};
  for (const [name, value] of Object.entries(read.keys)) {
    if (typeof value === "string") customKeys[name] = value;
  }
  return {
    id: row.id,
    provider: row.provider,
    customKeys,
    hasUnreadableKeys: read.state === "unreadable",
  };
}
