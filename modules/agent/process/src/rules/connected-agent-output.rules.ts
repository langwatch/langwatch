import type { ZodError } from "zod";

export type ConnectedAgentOutputFailure = Readonly<{
  issues: readonly Readonly<{ path: string; code: string }>[];
}>;

/**
 * Where an answer broke its schema and which rule it broke, never the value:
 * a protocol answer can carry a credential, so the log gets paths and codes.
 */
export function describeOutputFailure({ error }: { error: ZodError }): ConnectedAgentOutputFailure {
  return {
    issues: error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })),
  };
}
