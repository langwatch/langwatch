const PROJECT_GONE_NAME = "ProjectNotFoundError";
const PROJECT_GONE_CODE = "project_not_found";
const MAX_CAUSE_DEPTH = 8;

/**
 * Whether a failure says its project no longer exists: authorization's and project's
 * ProjectNotFoundError, read by name or code anywhere in the cause chain, or every member
 * of an AggregateError. Structural, so no package imports another's error class.
 */
export function isProjectGone(error: unknown): boolean {
  return projectGoneAt({ error, depth: 0 });
}

function projectGoneAt({ error, depth }: { error: unknown; depth: number }): boolean {
  if (depth > MAX_CAUSE_DEPTH || error === null || typeof error !== "object") return false;
  if (error instanceof AggregateError) {
    const members: unknown[] = error.errors;
    return (
      members.length > 0 &&
      members.every((member) => projectGoneAt({ error: member, depth: depth + 1 }))
    );
  }
  if (Reflect.get(error, "name") === PROJECT_GONE_NAME) return true;
  if (Reflect.get(error, "code") === PROJECT_GONE_CODE) return true;
  return projectGoneAt({ error: Reflect.get(error, "cause"), depth: depth + 1 });
}
