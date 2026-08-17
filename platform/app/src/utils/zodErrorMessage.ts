import { z } from "zod/v4";
import { fromError } from "zod-validation-error";

/**
 * A readable validation message for a ZodError from EITHER zod entrypoint.
 *
 * The repo runs both: most schemas are authored against the default (v3)
 * export, a few against `zod/v4` (see `predefinedEvents.schema.ts` and
 * `langyRelayFrame.ts`). The two throw different error objects, and
 * `zod-validation-error@3` only understands the v3 one — handed a v4 error it
 * reads `.errors`, which does not exist there, and throws
 * `TypeError: Cannot read properties of undefined (reading 'length')`.
 *
 * That TypeError escaped two `catch` blocks whose whole job was to turn a
 * validation failure into a 400, so `POST /api/events/track` answered a
 * malformed predefined event with a 500 and no indication of the offending
 * field. Anything that formats a ZodError for a caller goes through here.
 *
 * `z.prettifyError` is not enough on its own: for a union it renders
 * "✖ Invalid input" and drops the branch issues, so the reader never learns
 * which field was wrong. Union branches are flattened instead.
 */
export function zodErrorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    const parts = flattenV4Issues(error.issues);
    return parts.length > 0
      ? `Validation error: ${parts.join("; ")}`
      : z.prettifyError(error);
  }
  // `fromError`, not `fromZodError`: the latter throws its own TypeError on
  // anything that is not a v3 ZodError, which is the same failure mode this
  // helper exists to remove — a formatter that throws inside a catch block
  // turns a 400 into a 500.
  return fromError(error).message;
}

/** A v4 issue carries its own absolute path; a union nests one list per branch. */
interface V4IssueLike {
  code?: string;
  message?: string;
  path?: PropertyKey[];
  errors?: V4IssueLike[][];
}

function flattenV4Issues(issues: readonly V4IssueLike[]): string[] {
  const out: string[] = [];
  for (const issue of issues) {
    // A union reports one nested list per branch it tried. Its own message is
    // the useless "Invalid input"; the branches hold the field-level reasons.
    if (Array.isArray(issue.errors)) {
      for (const branch of issue.errors) out.push(...flattenV4Issues(branch));
      continue;
    }
    const path = (issue.path ?? []).join(".");
    const message = issue.message ?? "Invalid input";
    out.push(path ? `${message} at "${path}"` : message);
  }
  return out;
}
