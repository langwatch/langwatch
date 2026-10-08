// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

type AgentMetadataValue =
  | string
  | number
  | boolean
  | null
  | AgentMetadataValue[]
  | { [field: string]: AgentMetadataValue };

/** A provider's descriptive fields for one agent, as the JSON column holds them. */
export type AgentMetadata = { [field: string]: AgentMetadataValue };

function isAgentMetadata(value: unknown): value is AgentMetadata {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The stored metadata with this listing's fields laid over it; `changed` false lets the caller
 * skip the write. A stored non-object is a hand-edited row and is replaced outright.
 */
export function mergeAgentMetadata({
  stored,
  incoming,
}: {
  stored: unknown;
  incoming: Record<string, string>;
}): { metadata: AgentMetadata; changed: boolean } {
  if (!isAgentMetadata(stored)) return { metadata: incoming, changed: true };
  const unchanged = Object.entries(incoming).every(([field, value]) => stored[field] === value);
  if (unchanged) return { metadata: stored, changed: false };
  return { metadata: { ...stored, ...incoming }, changed: true };
}
