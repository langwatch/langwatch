import { useMemo } from "react";
import { modelProviders as serverModelProviders } from "../server/modelProviders/registry";
import { KEY_CHECK } from "../utils/constants";

export type ServerModelProviderKey = keyof typeof serverModelProviders;

export type DerivedFieldType = "text" | "password";

export interface DerivedFieldMeta {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
  type: DerivedFieldType;
}

function extractObjectShape(schema: any): Record<string, any> {
  if (!schema) return {};
  if ("shape" in schema) {
    return schema.shape as Record<string, any>;
  }
  if ("_def" in schema && schema._def && "schema" in schema._def) {
    const inner = (schema )._def.schema;
    if (inner && "shape" in inner) return inner.shape as Record<string, any>;
  }
  return {};
}

function isOptionalZodType(zodType: any): boolean {
  try {
    return (
      !!zodType &&
      ((zodType._def && zodType._def.typeName === "ZodOptional") ||
        // Optional chained via effects or passthrough can hide inside ._def.innerType
        (zodType._def?.innerType?._def &&
          zodType._def.innerType._def.typeName === "ZodOptional"))
    );
  } catch {
    return false;
  }
}

function deriveTypeFromKey(key: string): DerivedFieldType {
  return KEY_CHECK.some((k) => key.includes(k)) ? "password" : "text";
}

export interface UseModelProviderFieldsResult {
  fields: DerivedFieldMeta[];
  /** Keys in the order defined by the schema */
  fieldKeys: string[];
  /** Build defaults for a given stored customKeys, only including known keys */
  buildDefaultValues: (
    stored?: Record<string, unknown> | null,
  ) => Record<string, string>;
}

/**
 * Derive model provider field metadata from server registry keysSchema.
 * Single Responsibility: expose presentational field metadata for forms without handling form state.
 */
export function useModelProviderFields(
  providerKey: ServerModelProviderKey | string,
): UseModelProviderFieldsResult {
  return useMemo(() => {
    const provider =
      serverModelProviders[
        providerKey as keyof typeof serverModelProviders
      ] as (typeof serverModelProviders)[keyof typeof serverModelProviders] | undefined;

    const shape = extractObjectShape(provider?.keysSchema);
    const fieldKeys = Object.keys(shape ?? {});

    const fields: DerivedFieldMeta[] = fieldKeys.map((key) => {
      const zodType = (shape as any)[key];
      const optional = isOptionalZodType(zodType);
      return {
        key,
        label: key,
        required: !optional,
        placeholder: optional ? "optional" : undefined,
        type: deriveTypeFromKey(key),
      };
    });

    const buildDefaultValues = (stored?: Record<string, unknown> | null) => {
      const result: Record<string, string> = {};
      for (const key of fieldKeys) {
        const value = stored?.[key];
        result[key] = typeof value === "string" ? value : "";
      }
      return result;
    };

    return { fields, fieldKeys, buildDefaultValues };
  }, [providerKey]);
}


