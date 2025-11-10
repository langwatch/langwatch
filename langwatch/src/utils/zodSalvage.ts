import merge from "lodash-es/merge";
import { z } from "zod";

/**
 * Attempts to salvage valid parts of data that fails complete schema validation.
 *
 * Strategy:
 * 1. Try full parse - if successful, return as-is
 * 2. If failed, start with provided defaults or attempt schema.parse({})
 * 3. For each top-level key in input data, attempt to parse with that field's schema
 * 4. Keep fields that pass individual validation
 * 5. Merge salvaged fields with defaults
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
  let schemaDefaults: z.infer<T>;
  if (defaults) {
    schemaDefaults = defaults;
  } else {
    const defaultsResult = schema.safeParse({});
    if (defaultsResult.success) {
      schemaDefaults = defaultsResult.data;
    } else {
      // If schema requires fields and we have no defaults, throw
      throw new Error(
        "salvageValidData: schema requires fields but no defaults provided",
      );
    }
  }

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

    const fieldSchema = schema.shape[key];
    const fieldResult = fieldSchema.safeParse(value);

    if (fieldResult.success) {
      salvaged[key] = fieldResult.data;
    } else if (value && typeof value === "object") {
      // Check if the field schema is an object or has an unwrapped object type
      let objectSchema = fieldSchema;

      // Unwrap ZodDefault, ZodOptional, etc. to get to the underlying ZodObject
      while (
        objectSchema instanceof z.ZodDefault ||
        objectSchema instanceof z.ZodOptional ||
        objectSchema instanceof z.ZodNullable
      ) {
        objectSchema = objectSchema._def.innerType;
      }

      if (objectSchema instanceof z.ZodObject) {
        // Recursively salvage nested objects
        // Extract nested defaults if available
        const nestedDefaults =
          schemaDefaults[key as keyof typeof schemaDefaults];
        salvaged[key] = salvageValidData(
          objectSchema,
          value,
          nestedDefaults as any,
        );
      }
    }
    // If field fails validation and isn't a nested object, skip it (use default)
  }

  // Merge salvaged values with defaults (salvaged takes precedence)
  return merge({}, schemaDefaults, salvaged);
}
