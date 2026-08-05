import { useMemo } from "react";
import { modelProviders as serverModelProviders } from "../server/modelProviders/registry";
import {
  getDisplayKeysForProvider,
  getRequiredCredentialKeys,
  getSchemaShape,
  isApiKeyField,
} from "../utils/modelProviderHelpers";

export type ServerModelProviderKey = keyof typeof serverModelProviders;

export type DerivedFieldType = "text" | "password";

export interface DerivedFieldMeta {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
  type: DerivedFieldType;
}

function deriveTypeFromKey(key: string): DerivedFieldType {
  return isApiKeyField(key) ? "password" : "text";
}

export interface UseModelProviderFieldsResult {
  fields: DerivedFieldMeta[];

  /** Keys in the order defined by the schema */
  orderedFieldKeys: string[];

  /** Build defaults for a given stored customKeys, only including known keys */
  buildDefaultValues: (
    stored?: Record<string, unknown> | null,
  ) => Record<string, string>;
}

/**
 * Field metadata for a provider's credential inputs.
 *
 * `values` is what the customer has typed so far: requiredness depends on it
 * for providers that accept either an API key or a base URL, so pass the
 * live form state and the markers keep up. Omit it and every field is judged
 * against an empty form.
 *
 * `useApiGateway` mirrors the drawer's Azure toggle: requiredness is judged
 * over the fields actually on screen, so the hidden half of the Azure form
 * never decides anything.
 */
export function useModelProviderFields({
  providerKey,
  values,
  useApiGateway,
}: {
  // eslint-disable-next-line @typescript-eslint/ban-types
  providerKey: ServerModelProviderKey | (string & {});
  values?: Record<string, string>;
  useApiGateway?: boolean;
}): UseModelProviderFieldsResult {
  return useMemo(() => {
    const provider = serverModelProviders[
      providerKey as keyof typeof serverModelProviders
    ] as
      | (typeof serverModelProviders)[keyof typeof serverModelProviders]
      | undefined;

    const shape = getSchemaShape(provider?.keysSchema);
    const orderedFieldKeys = Object.keys(shape ?? {});

    const requiredKeys = getRequiredCredentialKeys({
      keysSchema: provider?.keysSchema,
      fieldSchemas: getDisplayKeysForProvider(
        providerKey,
        useApiGateway ?? false,
        shape,
      ),
      values: values ?? {},
      optionalKeys: (provider as { optionalKeys?: readonly string[] })
        ?.optionalKeys,
    });

    const fields: DerivedFieldMeta[] = orderedFieldKeys.map((key) => {
      const required = requiredKeys.has(key);
      return {
        key,
        label: key,
        required,
        placeholder: required ? undefined : "optional",
        type: deriveTypeFromKey(key),
      };
    });

    const buildDefaultValues = (stored?: Record<string, unknown> | null) => {
      const result: Record<string, string> = {};
      for (const key of orderedFieldKeys) {
        const value = stored?.[key];
        result[key] = typeof value === "string" ? value : "";
      }
      return result;
    };

    return { fields, orderedFieldKeys, buildDefaultValues };
  }, [providerKey, values, useApiGateway]);
}
