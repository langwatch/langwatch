import merge from "lodash-es/merge";
import { z } from "zod";

/**
 * The defaults every salvage merges onto: the caller's, or the schema's own for
 * an empty object. A schema with required fields and no defaults cannot produce
 * a valid result at all, so it throws.
 */
const resolveSchemaDefaults = ({
  schema,
  defaults,
}: {
  schema: any;
  defaults: any;
}): any => {
  if (defaults) {
    return defaults;
  }
  const defaultsResult = schema.safeParse({});
  if (defaultsResult.success) {
    return defaultsResult.data;
  }
  // If schema requires fields and we have no defaults, throw
  throw new Error(
    "salvageValidData: schema requires fields but no defaults provided",
  );
};

/** Unwrap ZodDefault, ZodOptional, etc. to get to the underlying ZodObject */
const unwrapToInnerSchema = (fieldSchema: any): any => {
  let objectSchema = fieldSchema;
  while (
    objectSchema instanceof z.ZodDefault ||
    objectSchema instanceof z.ZodOptional ||
    objectSchema instanceof z.ZodNullable
  ) {
    objectSchema = objectSchema._def.innerType;
  }
  return objectSchema;
};

/**
 * Per-field defaults built by parsing `undefined` through each key's schema.
 * This helps with optional nested objects that have required fields.
 */
const constructDefaultsFromShape = (
  objectSchema: any,
): Record<string, unknown> => {
  const constructedDefaults: Record<string, unknown> = {};
  for (const nestedKey of Object.keys(objectSchema.shape)) {
    if (Object.prototype.hasOwnProperty.call(objectSchema.shape, nestedKey)) {
      const nestedFieldSchema = objectSchema.shape[nestedKey];
      const fieldDefaultResult = nestedFieldSchema.safeParse(undefined);
      if (fieldDefaultResult.success) {
        constructedDefaults[nestedKey] = fieldDefaultResult.data;
      }
    }
  }
  return constructedDefaults;
};

/**
 * Defaults for a nested object: the ones handed down, else the nested schema's
 * own defaults for an empty object, else whatever its shape yields key by key.
 * `undefined` when none of the three produce anything.
 */
const resolveNestedDefaultValue = ({
  objectSchema,
  nestedDefaults,
}: {
  objectSchema: any;
  nestedDefaults: any;
}): unknown => {
  if (nestedDefaults !== undefined) {
    // Use provided nested defaults
    return nestedDefaults;
  }
  // Try to get defaults by parsing empty object
  const emptyParseResult = objectSchema.safeParse({});
  if (emptyParseResult.success) {
    return emptyParseResult.data;
  }
  // If that fails, try to construct defaults from schema shape
  const constructedDefaults = constructDefaultsFromShape(objectSchema);
  // Only use constructed defaults if we got something
  if (Object.keys(constructedDefaults).length > 0) {
    return constructedDefaults;
  }
  return undefined;
};

/**
 * Recursively salvage a nested object, with whatever defaults we can resolve
 * for it. For optional nested objects there may be none, in which case only a
 * clean direct parse is kept.
 */
const salvageNestedField = ({
  objectSchema,
  value,
  nestedDefaults,
  salvaged,
  key,
}: {
  objectSchema: any;
  value: unknown;
  nestedDefaults: any;
  salvaged: Record<string, unknown>;
  key: string;
}): void => {
  try {
    const nestedDefaultValue = resolveNestedDefaultValue({
      objectSchema,
      nestedDefaults,
    });

    // Now try to salvage with whatever defaults we have
    if (nestedDefaultValue !== undefined) {
      salvaged[key] = salvageValidData(objectSchema, value, nestedDefaultValue);
      return;
    }

    // No defaults at all - try direct parse
    const directParseResult = objectSchema.safeParse(value);
    if (directParseResult.success) {
      salvaged[key] = directParseResult.data;
    }
    // If parse fails and no defaults, leave salvaged[key] undefined
    // merge() will use the default from schemaDefaults
  } catch {
    // If salvage fails (e.g., required fields missing in optional nested object),
    // silently fall back to the default from schemaDefaults (may be undefined)
    salvaged[key] = nestedDefaults;
  }
};

/**
 * Salvage one top-level field: keep it whole when it validates, otherwise
 * recurse into it when it is a nested object schema. A field that fails
 * validation and isn't a nested object is skipped (use default).
 */
const salvageField = ({
  schema,
  schemaDefaults,
  salvaged,
  key,
  value,
}: {
  schema: any;
  schemaDefaults: any;
  salvaged: Record<string, unknown>;
  key: string;
  value: unknown;
}): void => {
  const fieldSchema = schema.shape[key];
  const fieldResult = fieldSchema.safeParse(value);

  if (fieldResult.success) {
    salvaged[key] = fieldResult.data;
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }

  // Check if the field schema is an object or has an unwrapped object type
  const objectSchema = unwrapToInnerSchema(fieldSchema);
  if (!(objectSchema instanceof z.ZodObject)) {
    return;
  }

  // Extract nested defaults if available
  const nestedDefaults = schemaDefaults[key as keyof typeof schemaDefaults];
  salvageNestedField({ objectSchema, value, nestedDefaults, salvaged, key });
};

/**
 * Attempts to salvage valid parts of data that fails complete schema validation.
 *
 * Strategy:
 * 1. Try full parse - if successful, return as-is
 * 2. If failed, start with provided defaults or attempt schema.safeParse({})
 * 3. For each top-level key in input data, attempt to parse with that field's schema
 * 4. Keep fields that pass individual validation
 * 5. Recursively salvage nested objects
 * 6. Merge salvaged fields with defaults
 *
 * This is more intelligent than discarding all data on validation failure,
 * as it preserves any valid portions while falling back to defaults only
 * for truly invalid fields.
 *
 * @param schema - Zod schema to validate against (must be z.object())
 * @param data - Potentially corrupted data to salvage
 * @param defaults - Optional pre-computed defaults to use if schema parsing fails
 * @returns Fully valid data with salvaged parts merged with defaults
 */
export function salvageValidData<T extends z.ZodObject<any>>(
  schema: T,
  data: unknown,
  defaults?: z.infer<T>,
): z.infer<T> {
  // Try full parse first
  const fullResult = schema.safeParse(data);
  if (fullResult.success) {
    return fullResult.data;
  }

  // Get defaults - use provided or try parsing empty object
  const schemaDefaults: z.infer<T> = resolveSchemaDefaults({
    schema,
    defaults,
  });

  // If input isn't an object, just return defaults
  if (!data || typeof data !== "object") {
    return schemaDefaults;
  }

  const salvaged: Record<string, unknown> = {};
  const inputData = data as Record<string, unknown>;

  // Try to salvage each top-level field
  for (const [key, value] of Object.entries(inputData)) {
    if (!(key in schema.shape)) {
      continue; // Skip keys not in schema
    }

    salvageField({ schema, schemaDefaults, salvaged, key, value });
  }

  // Merge salvaged values with defaults (salvaged takes precedence)
  return merge({}, schemaDefaults, salvaged);
}
