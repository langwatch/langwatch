import type { Context } from "hono";
import { hasProjectPermission } from "~/server/api/rbac";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";

type Session = Awaited<ReturnType<typeof getServerAuthSession>>;

/**
 * Common guard for Langy routes: requires a logged-in session, a non-empty
 * projectId, and the "evaluations:view" capability on that project. On
 * failure, returns `{ error: Response }` ready to be returned directly from
 * the route handler. On success, returns `{ session }`.
 */
export async function requireSessionAndPermission(
  c: Context,
  projectId: string | undefined,
): Promise<{ error: Response; session?: never } | { session: NonNullable<Session>; error?: never }> {
  const session = await getServerAuthSession({ req: c.req.raw as never });
  if (!session) {
    return {
      error: c.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!projectId) {
    return {
      error: c.json({ error: "Missing projectId" }, { status: 400 }),
    };
  }
  const ok = await hasProjectPermission(
    { prisma, session },
    projectId,
    "evaluations:view",
  );
  if (!ok) {
    return { error: c.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

/**
 * Stricter check used by mutating project-memory routes — caller must have
 * "project:manage". Caller already passed requireSessionAndPermission, so
 * `session` is guaranteed non-null.
 */
export async function requireProjectAdmin(
  session: NonNullable<Session>,
  projectId: string,
): Promise<boolean> {
  return await hasProjectPermission(
    { prisma, session },
    projectId,
    "project:manage",
  );
}
