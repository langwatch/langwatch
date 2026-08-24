import { z } from "zod";
import { fromError } from "zod-validation-error";

/**
 * A readable validation message for a Zod 4 error.
 *
 * `z.prettifyError` is not enough on its own: for a union it renders
 * "✖ Invalid input" and drops the branch issues, so the reader never learns
 * which field was wrong. Union branches are flattened instead.
 */
export function zodErrorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    const parts = flattenZodIssues(error.issues);
    return parts.length > 0
      ? `Validation error: ${parts.join("; ")}`
      : z.prettifyError(error);
  }
  // `fromError`, not `fromZodError`, because this branch intentionally handles
  // non-Zod failures as well.
  return fromError(error).message;
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
