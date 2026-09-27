import { readCustomKeys } from "~/server/modelProviders/customKeys";

/**
 * A model provider row as the checkup tests it: the `customKeys` column is
 * stored encrypted, so it is read through `readCustomKeys` before a key is
 * looked up in it. A row whose keys will not decrypt reads as holding none.
 */
export function checkupModelProviderRow(row: {
  id: string;
  provider: string;
  customKeys: unknown;
}): { id: string; provider: string; customKeys: Record<string, string> } {
  const read = readCustomKeys(row.customKeys);
  const customKeys: Record<string, string> = {};
  for (const [name, value] of Object.entries(read.keys)) {
    if (typeof value === "string") customKeys[name] = value;
  }
  return { id: row.id, provider: row.provider, customKeys };
}
