import { modelProviders as modelProvidersRegistry } from "@langwatch/model-provider-contract";
import { useMemo } from "react";

import { getRequiredCredentialKeys } from "../model/model-provider-helpers.ts";

/**
 * Credential fields the customer must fill in, given what they have entered so far. Both field
 * rendering and Save-time validation read this same answer so they can never disagree; see
 * `getRequiredCredentialKeys` for how the required set shifts as the customer types.
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
