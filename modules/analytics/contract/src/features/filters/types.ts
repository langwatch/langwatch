import type { Named } from "@langwatch/module";
import { z } from "zod";

import { type FilterField, filterFieldsEnum } from "../../analytics.filter-field.ts";

// Schema for trigger filter values - can be nested up to 2 levels deep
const filterValueSchema: z.ZodType<
  string[] | Record<string, string[]> | Record<string, Record<string, string[]>>
> = z.lazy(() =>
  z.union([
    z.array(z.string()),
    z.record(z.string(), z.array(z.string())),
    z.record(z.string(), z.record(z.string(), z.array(z.string()))),
  ]),
);

export type TriggerFilterValue = z.infer<typeof filterValueSchema>;
export type TriggerFilters = Partial<Record<FilterField, TriggerFilterValue>>;

// Schema for validating trigger filter JSON structure — rejects unknown fields
const triggerFiltersSchemaDefinition = z.partialRecord(filterFieldsEnum, filterValueSchema);
export interface TriggerFiltersSchema extends Named<typeof triggerFiltersSchemaDefinition> {}
export const triggerFiltersSchema: TriggerFiltersSchema = triggerFiltersSchemaDefinition;

/** Validates filter value structure without restricting field names. */
const triggerFiltersPermissiveSchemaDefinition = z.record(z.string(), filterValueSchema);
export interface TriggerFiltersPermissiveSchema extends Named<
  typeof triggerFiltersPermissiveSchemaDefinition
> {}
export const triggerFiltersPermissiveSchema: TriggerFiltersPermissiveSchema =
  triggerFiltersPermissiveSchemaDefinition;

const validFilterFields = new Set<string>(filterFieldsEnum.options);

const isTriggerFilterField = (field: string): field is FilterField => validFilterFields.has(field);

export const sanitizeTriggerFilters = (
  filters: Record<string, TriggerFilterValue>,
): { sanitized: TriggerFilters; unknownFields: string[] } => {
  const sanitized: TriggerFilters = {};
  const unknownFields: string[] = [];

  for (const [key, value] of Object.entries(filters)) {
    if (isTriggerFilterField(key)) {
      sanitized[key] = value;
    } else {
      unknownFields.push(key);
    }
  }

  return { sanitized, unknownFields };
};

export type FilterDefinition = {
  name: string;
  urlKey: string;
  single?: boolean;
  type?: "numeric";
  requiresKey?: {
    filter: FilterField;
  };
  requiresSubkey?: {
    filter: FilterField;
  };
};
