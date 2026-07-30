import { useMemo } from "react";
import { modelProviders as modelProvidersRegistry } from "../server/modelProviders/registry";
import { getRequiredCredentialKeys } from "../utils/modelProviderHelpers";

/**
 * Credential fields the customer must fill in for this provider, given what
 * they have entered so far. Both the field rendering (required marker) and
 * the Save-time validation message read the same answer, so a field can
 * never be marked required by one and waved through by the other.
 *
 * See `getRequiredCredentialKeys`: providers that accept either an API key
 * or a base URL move a field in and out of the required set as the customer
 * types, so this recomputes with the values.
 */
export function useRequiredCredentialKeys({
  providerKey,
  displayKeys,
  customKeys,
}: {
  providerKey: string;
  displayKeys: Record<string, unknown>;
  customKeys: Record<string, string>;
}): Set<string> {
  return useMemo(() => {
    const definition = modelProvidersRegistry[
      providerKey as keyof typeof modelProvidersRegistry
    ] as { keysSchema?: unknown; optionalKeys?: readonly string[] } | undefined;

    return getRequiredCredentialKeys({
      keysSchema: definition?.keysSchema,
      fieldSchemas: displayKeys,
      values: customKeys,
      optionalKeys: definition?.optionalKeys,
    });
  }, [providerKey, displayKeys, customKeys]);
}
