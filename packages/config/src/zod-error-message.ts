import { z } from "zod";

/**
 * A readable validation message for a Zod 4 error. `z.prettifyError` alone
 * renders a union as "✖ Invalid input", dropping which branch failed - so
 * union branches are flattened instead.
 */
export function zodErrorMessage(error: unknown): string {
  // Structural, not `instanceof`: two Zod majors in one graph are two classes.
  const issues = (error as { issues?: unknown } | null)?.issues;
  if (Array.isArray(issues)) {
    const parts = flattenZodIssues(issues as ZodIssueLike[]);
    return parts.length > 0
      ? `Validation error: ${parts.join("; ")}`
      : z.prettifyError(error as z.ZodError);
  }
  // This branch intentionally handles non-Zod failures as well.
  return error instanceof Error ? error.message : String(error);
}

/** A Zod 4 issue carries its own absolute path; a union nests one list per branch. */
interface ZodIssueLike {
  code?: string;
  message?: string;
  path?: PropertyKey[];
  errors?: ZodIssueLike[][];
}

function flattenZodIssues(issues: readonly ZodIssueLike[]): string[] {
  const out: string[] = [];
  for (const issue of issues) {
    // A union reports one nested list per branch it tried. Its own message is
    // the useless "Invalid input"; the branches hold the field-level reasons.
    if (Array.isArray(issue.errors)) {
      for (const branch of issue.errors) out.push(...flattenZodIssues(branch));
      continue;
    }
    const path = (issue.path ?? []).join(".");
    const message = issue.message ?? "Invalid input";
    out.push(path ? `${message} at "${path}"` : message);
  }
  return out;
}
