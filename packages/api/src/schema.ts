import type { StandardSchemaV1 } from "@standard-schema/spec";

/** The transport boundary accepts any Standard Schema implementation. */
export type ApiSchema = StandardSchemaV1<unknown, unknown>;
export type ApiSchemaOutput<TSchema extends ApiSchema> = StandardSchemaV1.InferOutput<TSchema>;

export type ApiSchemaIssue = Readonly<{
  code?: string;
  message: string;
  path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}>;

export type ApiSchemaError = Error & {
  readonly issues: readonly ApiSchemaIssue[];
  flatten(): {
    formErrors: string[];
    fieldErrors: Record<string, string[]>;
  };
};

export type ApiSchemaResult =
  | { success: true; data: unknown }
  | { success: false; error: ApiSchemaError };

export function parseApiSchemaSync(schema: ApiSchema, value: unknown): ApiSchemaResult {
  const zodLike = schema as {
    safeParse?: (
      input: unknown,
    ) => { success: true; data: unknown } | { success: false; error: ApiSchemaError };
  };
  if (zodLike.safeParse) return zodLike.safeParse(value);

  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) {
    throw new TypeError("Async Standard Schemas are not supported here");
  }
  return result.issues
    ? { success: false, error: createApiSchemaError(result.issues) }
    : { success: true, data: result.value };
}

export async function parseApiSchema(schema: ApiSchema, value: unknown): Promise<ApiSchemaResult> {
  const zodLike = schema as {
    safeParseAsync?: (
      input: unknown,
    ) => Promise<{ success: true; data: unknown } | { success: false; error: ApiSchemaError }>;
  };
  if (zodLike.safeParseAsync) return zodLike.safeParseAsync(value);

  const result = await schema["~standard"].validate(value);
  return result.issues
    ? { success: false, error: createApiSchemaError(result.issues) }
    : { success: true, data: result.value };
}

export function createApiSchemaError(issues: readonly ApiSchemaIssue[]): ApiSchemaError {
  const wrapped = new Error("Validation error") as ApiSchemaError;
  wrapped.name = "ZodError";
  Object.defineProperties(wrapped, {
    issues: { value: issues, enumerable: true },
    flatten: {
      value: () => {
        const formErrors: string[] = [];
        const fieldErrors: Record<string, string[]> = {};
        for (const issue of issues) {
          const field = pathOf(issue.path);
          if (!field) {
            formErrors.push(issue.message);
            continue;
          }
          (fieldErrors[field] ??= []).push(issue.message);
        }
        return { formErrors, fieldErrors };
      },
    },
  });
  return wrapped;
}

function pathOf(path: ApiSchemaIssue["path"]): string {
  return (path ?? [])
    .map((segment) =>
      typeof segment === "object" && segment !== null && "key" in segment
        ? String(segment.key)
        : String(segment),
    )
    .join(".");
}
