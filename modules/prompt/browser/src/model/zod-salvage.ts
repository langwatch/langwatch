import merge from "lodash-es/merge";
import { z } from "zod";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Builds a defaults object from a nested object schema's own shape, one field
 * at a time, for the case where the schema itself has no usable empty parse
 * (required fields with no top-level default).
 */
function constructDefaultsFromShape(
  objectSchema: z.ZodObject,
): Record<string, unknown> | undefined {
  const constructedDefaults: Record<string, unknown> = {};
  for (const nestedKey of Object.keys(objectSchema.shape)) {
    const isOwnKey = Object.hasOwn(objectSchema.shape, nestedKey);
    if (!isOwnKey) {
      continue;
    }
    const nestedFieldSchema = objectSchema.shape[nestedKey];
    const fieldDefaultResult = nestedFieldSchema.safeParse(undefined);
    if (fieldDefaultResult.success) {
      constructedDefaults[nestedKey] = fieldDefaultResult.data;
    }
  }
  return Object.keys(constructedDefaults).length > 0 ? constructedDefaults : undefined;
}

/**
 * Resolves the default value to salvage a nested object against: the caller's
 * own nested defaults if given, else the schema's empty parse, else defaults
 * constructed field-by-field from the schema's shape.
 */
function resolveNestedDefaultValue(objectSchema: z.ZodObject, nestedDefaults: unknown): unknown {
  if (nestedDefaults !== undefined) {
    return nestedDefaults;
  }
  const emptyParseResult = objectSchema.safeParse({});
  if (emptyParseResult.success) {
    return emptyParseResult.data;
  }
  return constructDefaultsFromShape(objectSchema);
}

/**
 * Salvages one nested object field: recurses through `salvageValidData` when there is a
 * record of defaults to fall back to, otherwise tries a direct parse and leaves the field
 * undefined (so the caller's merge falls back to `schemaDefaults`) when that also fails.
 */
function salvageNestedField(
  objectSchema: z.ZodObject,
  value: unknown,
  nestedDefaultValue: unknown,
): unknown {
  if (isRecord(nestedDefaultValue)) {
    return salvageValidData(objectSchema, value, nestedDefaultValue);
  }
  const directParseResult = objectSchema.safeParse(value);
  return directParseResult.success ? directParseResult.data : undefined;
}

function unwrapObjectSchema(schema: unknown): z.ZodObject | null {
  let current = schema;
  while (
    current instanceof z.ZodDefault ||
    current instanceof z.ZodOptional ||
    current instanceof z.ZodNullable
  ) {
    current = current.unwrap();
  }
  return current instanceof z.ZodObject ? current : null;
}

/**
 * Attempts to salvage valid parts of data that fails complete schema
 * validation, keeping any field that parses on its own and falling back to
 * defaults only for the fields that don't.
 */
export function salvageValidData<T extends z.ZodObject>(
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
      throw new Error("salvageValidData: schema requires fields but no defaults provided");
    }
  }

  // If input isn't an object, just return defaults
  if (!data || typeof data !== "object") {
    return schemaDefaults;
  }

  const salvaged: Record<string, unknown> = {};
  const inputData = data as Record<string, unknown>;

  salvageTopLevelFields({
    inputData,
    schema,
    schemaDefaults,
    salvaged,
  });

  // Merge salvaged values with defaults (salvaged takes precedence)
  return merge({}, schemaDefaults, salvaged);
}

function salvageTopLevelFields<T extends z.ZodObject>({
  inputData,
  schema,
  schemaDefaults,
  salvaged,
}: {
  inputData: Record<string, unknown>;
  schema: T;
  schemaDefaults: z.infer<T>;
  salvaged: Record<string, unknown>;
}): void {
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
      const objectSchema = unwrapObjectSchema(fieldSchema);

      if (objectSchema) {
        // Recursively salvage nested objects, falling back to whatever
        // defaults are available (the caller's, the schema's own empty
        // parse, or ones constructed field-by-field from its shape).
        const nestedDefaults = schemaDefaults[key as keyof typeof schemaDefaults];

        try {
          const nestedDefaultValue = resolveNestedDefaultValue(objectSchema, nestedDefaults);
          salvaged[key] = salvageNestedField(objectSchema, value, nestedDefaultValue);
        } catch {
          // If salvage fails (e.g., required fields missing in optional nested object),
          // silently fall back to the default from schemaDefaults (may be undefined)
          salvaged[key] = nestedDefaults;
        }
      }
    }
    // If field fails validation and isn't a nested object, skip it (use default)
  }
}
