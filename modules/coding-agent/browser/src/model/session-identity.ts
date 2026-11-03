/**
 * Which session a row is: the project that recorded it and its id. A group
 * project lists several member projects, and two of them may record the same
 * session id, so the id alone names neither.
 */
export interface SessionIdentity {
  tenantId: string;
  sessionId: string;
}

/** One string per session identity, for React keys and the replay's in-flight set. */
export function sessionIdentityKey({ tenantId, sessionId }: SessionIdentity): string {
  return JSON.stringify([tenantId, sessionId]);
}

/** The member project to name to a trace read made from `projectId`, when it is another one. */
export function memberTenantOf({
  tenantId,
  projectId,
}: {
  tenantId: string;
  projectId: string;
}): string | undefined {
  return tenantId !== "" && tenantId !== projectId ? tenantId : undefined;
}

/** Whether the rows came from more than one project, so each must say which. */
export function spansSeveralProjects(rows: readonly { tenantId: string }[]): boolean {
  return new Set(rows.map((row) => row.tenantId)).size > 1;
}
