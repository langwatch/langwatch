import {
  z,
  ZodArray,
  ZodNullable,
  ZodObject,
  ZodOptional,
  ZodTuple,
  type ZodType,
} from "zod";

// Recursively rebuild an object schema tree, applying `map` to every ZodObject
// node so the object's unknown-key mode (passthrough/strip/strict) is set at
// every level. In zod 4 the unknown-key mode is a runtime concern only (it is
// no longer encoded in the schema's type), so the deep* helpers return the same
// type as the input — the transformation is purely at the value level.
type ZodObjectMapper = (o: ZodObject) => ZodObject;

function deepApplyObject(schema: ZodType, map: ZodObjectMapper): ZodType {
  if (schema instanceof ZodObject) {
    const newShape: Record<string, ZodType> = {};
    for (const key of Object.keys(schema.shape)) {
      newShape[key] = deepApplyObject(schema.shape[key] as ZodType, map);
    }
    return map(z.object(newShape));
  } else if (schema instanceof ZodArray) {
    return z.array(deepApplyObject(schema.element as ZodType, map));
  } else if (schema instanceof ZodOptional) {
    return z.optional(deepApplyObject(schema.unwrap() as ZodType, map));
  } else if (schema instanceof ZodNullable) {
    return z.nullable(deepApplyObject(schema.unwrap() as ZodType, map));
  } else if (schema instanceof ZodTuple) {
    const items = schema.def.items.map((item) =>
      deepApplyObject(item as ZodType, map),
    );
    return z.tuple(items as [ZodType, ...ZodType[]]);
  } else {
    return schema;
  }
}

export function deepPassthrough<T extends ZodType>(schema: T): T {
  return deepApplyObject(schema, (s) => s.loose()) as unknown as T;
}

export function deepStrip<T extends ZodType>(schema: T): T {
  return deepApplyObject(schema, (s) => s.strip()) as unknown as T;
}

export function deepStrict<T extends ZodType>(schema: T, _error?: Error): T {
  return deepApplyObject(schema, (s) => s.strict()) as unknown as T;
}

/**
 * Maps Zod issues to a structured log-friendly format.
 * Extracts path, code, and message for consistent logging.
 */
export function mapZodIssuesToLogContext(
  issues: Array<{ path: (string | number)[]; code: string; message: string }>,
): Array<{ path: string; code: string; message: string }> {
  return issues.map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  }));
}

export interface ZodIssue {
  code: string;
  expected?: string;
  received?: string;
  path: string[];
  message: string;
}

export interface ZodErrorStructure {
  issues: Array<
    ZodIssue & {
      unionErrors?: Array<{
        issues: ZodIssue[];
        name: string;
      }>;
    }
  >;
}

/**
 * Converts a single Zod issue to a friendly error message
 */
export function getZodIssueMessage(issue: ZodIssue): string {
  // For invalid_type with undefined, show "Required"
  if (issue.code === "invalid_type" && issue.received === "undefined") {
    return "This field is required";
  }

  // For other invalid_type errors
  if (issue.code === "invalid_type") {
    return `Expected ${issue.expected}, received ${issue.received}`;
  }

  // For other error codes, return the message or a default
  return issue.message || "Invalid value";
}

/**
 * Parses Zod error to extract field-specific error messages
 */
export function parseZodFieldErrors(
  zodError: ZodErrorStructure,
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  // Handle union errors by flattening them
  if (zodError.issues) {
    zodError.issues.forEach((issue) => {
      if (issue.unionErrors) {
        // Flatten union errors
        issue.unionErrors.forEach((unionError) => {
          unionError.issues?.forEach((nestedIssue) => {
            if (nestedIssue.path && nestedIssue.path.length > 0) {
              const fieldName = nestedIssue.path[0];
              if (
                fieldName &&
                typeof fieldName === "string" &&
                !fieldErrors[fieldName]
              ) {
                fieldErrors[fieldName] = getZodIssueMessage(nestedIssue);
              }
            }
          });
        });
      } else if (issue.path && issue.path.length > 0) {
        const fieldName = issue.path[0];
        if (
          fieldName &&
          typeof fieldName === "string" &&
          !fieldErrors[fieldName]
        ) {
          fieldErrors[fieldName] = getZodIssueMessage(issue);
        }
      }
    });
  }

  return fieldErrors;
}
