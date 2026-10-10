// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A recorded request, in the words an administrator reads (ADR-126).
 * The stored resource keeps `:id` so the same ask groups into rows of one
 * shape — a routing convention nobody reading their directory has to know.
 */
const RESOURCE_WORDS: Record<string, string> = {
  Users: "users",
  "Users/:id": "one user",
  Groups: "groups",
  "Groups/:id": "one group",
  ServiceProviderConfig: "our configuration",
  Schemas: "our schemas",
  ResourceTypes: "our resource types",
};

export function resourceInWords(resource: string): string {
  return RESOURCE_WORDS[resource] ?? resource;
}

/**
 * What kind of refusal it was, where we have no sentence of our own. Every
 * slug is one we chose, so putting it into words costs nothing and an
 * unmapped one falls through to the slug rather than to silence.
 */
const REASON_WORDS: Record<string, string> = {
  plan_not_entitled: "Your plan no longer includes directory sync",
  forbidden: "Your directory asked for something this connection may not do",
  unauthorized: "The token presented was not one we recognize",
  malformed_body: "The request body could not be read as JSON",
  invalid_resource: "The resource sent was not one we can accept",
  not_found: "The person or group named does not exist here",
  conflict: "That would collide with something already here",
  rate_limited: "Too many requests arrived at once",
  unsupported: "Your provider asked for something we do not offer",
  internal_error: "Something on our side went wrong",
};

export function reasonInWords(reason: string | null): string | null {
  if (!reason) return null;

  return REASON_WORDS[reason] ?? reason;
}

/** What the directory has to act on, rather than what we accepted. */
export function isRefusal(status: number): boolean {
  return status >= 400;
}
