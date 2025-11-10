import merge from "lodash-es/merge";
import { z } from "zod";

/**
 * Attempts to salvage valid parts of data that fails complete schema validation.
 *
 * Strategy:
 * 1. Try full parse - if successful, return as-is
 * 2. If failed, start with schema defaults
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
 * @returns Fully valid data with salvaged parts merged with defaults
 */
export function salvageValidData<T extends z.ZodObject<any>>(
  schema: T,
  data: unknown,
): z.infer<T> {
  // Try full parse first
  const fullResult = schema.safeParse(data);
  if (fullResult.success) {
    return fullResult.data;
  }

  // Parse empty object to get defaults
  const defaults = schema.parse({});

  // If input isn't an object, just return defaults
  if (!data || typeof data !== "object") {
    return defaults;
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
    } else if (value && typeof value === "object" && fieldSchema instanceof z.ZodObject) {
      // If the field is itself an object schema, recursively salvage it
      salvaged[key] = salvageValidData(fieldSchema, value);
    }
    // If field fails validation and isn't a nested object, skip it (use default)
  }

  // Merge salvaged values with defaults (salvaged takes precedence)
  return merge({}, defaults, salvaged);
}

