/**
 * Maps Zod issues to a structured log-friendly format.
 * Extracts path, code, and message for consistent logging.
 */
export function mapZodIssuesToLogContext(
  issues: { path: PropertyKey[]; code: string; message: string }[],
): { path: string; code: string; message: string }[] {
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

/** One issue, which for a union carries the branches it tried. */
export type UnionAwareIssue = ZodIssue & {
  unionErrors?: {
    issues: UnionAwareIssue[];
    name: string;
  }[];
};

export interface ZodErrorStructure {
  issues: UnionAwareIssue[];
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
  for (const issue of flattenUnions(zodError.issues ?? [])) {
    claimField(fieldErrors, issue);
  }
  return fieldErrors;
}

/** A union reports one nested error per branch; the branches hold the fields. */
function flattenUnions(issues: readonly UnionAwareIssue[]): ZodIssue[] {
  return issues.flatMap((issue) =>
    issue.unionErrors ? flattenUnions(issue.unionErrors.flatMap((union) => union.issues)) : [issue],
  );
}

/** First issue to name a field wins, so the earliest reason is the one shown. */
function claimField(fieldErrors: Record<string, string>, issue: ZodIssue): void {
  const fieldName = issue.path?.[0];
  if (typeof fieldName !== "string" || fieldErrors[fieldName]) return;
  fieldErrors[fieldName] = getZodIssueMessage(issue);
}
