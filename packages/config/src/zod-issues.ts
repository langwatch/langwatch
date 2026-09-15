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
export function parseZodFieldErrors(zodError: ZodErrorStructure): Record<string, string> {
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
              if (fieldName && typeof fieldName === "string" && !fieldErrors[fieldName]) {
                fieldErrors[fieldName] = getZodIssueMessage(nestedIssue);
              }
            }
          });
        });
      } else if (issue.path && issue.path.length > 0) {
        const fieldName = issue.path[0];
        if (fieldName && typeof fieldName === "string" && !fieldErrors[fieldName]) {
          fieldErrors[fieldName] = getZodIssueMessage(issue);
        }
      }
    });
  }

  return fieldErrors;
}
