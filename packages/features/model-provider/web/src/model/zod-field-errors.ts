/**
 * Maps Zod issues to a structured log-friendly format.
 * Extracts path, code, and message for consistent logging.
 */
export function mapZodIssuesToLogContext(
  issues: Array<{ path: PropertyKey[]; code: string; message: string }>,
): Array<{ path: string; code: string; message: string }> {
  return issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    code: issue.code,
    message: issue.message,
  }));
}

/**
 * Field errors keyed by the issue's first path segment. Later issues on the
 * same field win, which is how the custom-model dialogs have always read them.
 */
export function fieldErrorsFromZodIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (!field) continue;

    fieldErrors[String(field)] = issue.message;
  }

  return fieldErrors;
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

/** First named path segment wins: the first issue to name a field owns its message. */
function recordFieldError({
  fieldErrors,
  issue,
}: {
  fieldErrors: Record<string, string>;
  issue: ZodIssue;
}): void {
  const fieldName = issue.path?.[0];
  if (typeof fieldName !== "string" || fieldName.length === 0) return;
  if (fieldErrors[fieldName]) return;

  fieldErrors[fieldName] = getZodIssueMessage(issue);
}

/**
 * Parses Zod error to extract field-specific error messages
 */
export function parseZodFieldErrors(zodError: ZodErrorStructure): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  if (!zodError.issues) return fieldErrors;

  for (const issue of zodError.issues) {
    if (!issue.unionErrors) {
      recordFieldError({ fieldErrors, issue });
      continue;
    }

    for (const unionError of issue.unionErrors) {
      for (const nestedIssue of unionError.issues ?? []) {
        recordFieldError({ fieldErrors, issue: nestedIssue });
      }
    }
  }

  return fieldErrors;
}
