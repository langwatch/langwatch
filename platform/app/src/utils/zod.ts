import {
  type UnknownKeysParam,
  ZodArray,
  ZodNullable,
  ZodObject,
  ZodOptional,
  type ZodRawShape,
  ZodTuple,
  type ZodTupleItems,
  type ZodTypeAny,
} from "zod";

type ZodObjectMapper<T extends ZodRawShape, U extends UnknownKeysParam> = (
  o: ZodObject<T>,
) => ZodObject<T, U>;

function deepApplyObject(
  schema: ZodTypeAny,
  map: ZodObjectMapper<any, any>,
): any {
  if (schema instanceof ZodObject) {
    const newShape: Record<string, ZodTypeAny> = {};
    for (const key of Object.keys(schema.shape)) {
      const fieldSchema = schema.shape[key];
      newShape[key] = deepApplyObject(fieldSchema, map);
    }
    const newObject = new ZodObject({
      ...schema._def,
      shape: () => newShape,
    });
    return map(newObject);
  } else if (schema instanceof ZodArray) {
    return ZodArray.create(deepApplyObject(schema.element, map));
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepApplyObject(schema.unwrap(), map));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepApplyObject(schema.unwrap(), map));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(
      schema.items.map((item: any) => deepApplyObject(item, map)),
    );
  } else {
    return schema;
  }
}

type DeepUnknownKeys<
  T extends ZodTypeAny,
  UnknownKeys extends UnknownKeysParam,
> = T extends ZodObject<infer Shape, infer _, infer Catchall>
  ? ZodObject<
      {
        [k in keyof Shape]: DeepUnknownKeys<Shape[k], UnknownKeys>;
      },
      UnknownKeys,
      Catchall
    >
  : T extends ZodArray<infer Type, infer Card>
    ? ZodArray<DeepUnknownKeys<Type, UnknownKeys>, Card>
    : T extends ZodOptional<infer Type>
      ? ZodOptional<DeepUnknownKeys<Type, UnknownKeys>>
      : T extends ZodNullable<infer Type>
        ? ZodNullable<DeepUnknownKeys<Type, UnknownKeys>>
        : T extends ZodTuple<infer Items>
          ? {
              [k in keyof Items]: Items[k] extends ZodTypeAny
                ? DeepUnknownKeys<Items[k], UnknownKeys>
                : never;
            } extends infer PI
            ? PI extends ZodTupleItems
              ? ZodTuple<PI>
              : never
            : never
          : T;

type DeepPassthrough<T extends ZodTypeAny> = DeepUnknownKeys<T, "passthrough">;
export function deepPassthrough<T extends ZodTypeAny>(
  schema: T,
): DeepPassthrough<T> {
  return deepApplyObject(schema, (s) => s.passthrough()) as DeepPassthrough<T>;
}

type DeepStrip<T extends ZodTypeAny> = DeepUnknownKeys<T, "strip">;
export function deepStrip<T extends ZodTypeAny>(schema: T): DeepStrip<T> {
  return deepApplyObject(schema, (s) => s.strip()) as DeepStrip<T>;
}

type DeepStrict<T extends ZodTypeAny> = DeepUnknownKeys<T, "strict">;
export function deepStrict<T extends ZodTypeAny>(
  schema: T,
  error?: Error,
): DeepStrict<T> {
  return deepApplyObject(schema, (s) => s.strict(error)) as DeepStrict<T>;
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
