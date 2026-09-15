export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function mapValidationIssues(
  issues: ReadonlyArray<{
    path: ReadonlyArray<PropertyKey>;
    code: string;
    message: string;
  }>,
): Array<{ path: string; code: string; message: string }> {
  return issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    code: issue.code,
    message: issue.message,
  }));
}
