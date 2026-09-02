/**
 * The back-office transport: `/api/admin/impersonate` and `/api/admin/:resource`.
 *
 * The Ops service owns everything that decides anything — which resource
 * operations exist, which selects are safe, what a mutation writes and what it
 * audits. This family owns only the HTTP half: who is asking, how the body is
 * read, which URL spellings are accepted, and the wire shape React Admin
 * already parses.
 *
 * TWO SESSIONS ARE READ, AND THEY ARE NOT THE SAME QUESTION. The first is
 * "who is acting" — resolved through the process's own session port, and read
 * as the IMPERSONATOR where one is present, so an admin who is currently
 * impersonating somebody remains the actor rather than borrowing their
 * subject's identity. The second is the RAW auth session, whose id is the row
 * impersonation is started and stopped against; a request whose cookie has
 * since expired has an actor and no session to attach to, which is a 401 and
 * not a permission failure.
 *
 * The credential is resolved in-handler and the family declares
 * `handlerManagedAuth` so the route-policy registry still records it. It
 * carries no permission: `isAdmin` is not an RBAC grain — it is instance
 * staff — and declaring a project permission it never checks would tell an
 * authorization audit something untrue.
 */
import { handlerManagedAuth } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import { HandledError, ValidationError } from "@langwatch/handled-error";
import type { Context } from "hono";

import {
  AdminSurfaceHiddenError,
  adminOperationRequestSchema,
  adminResourceNameSchema,
  type AdminAuditRequest,
} from "@langwatch/ops-contract";

import type { OpsApp } from "../../app/ops.app";

/**
 * Who is acting, as this process resolves it.
 *
 * `impersonator` is what makes the actor the admin rather than the person they
 * are currently impersonating — a back-office write must be attributed to the
 * human who made it.
 */
export type AdminRestActor = Readonly<{
  user: AdminRestUser;
}>;

/**
 * The acting person, at the two grains this family reads them at: `id` is what
 * a write is attributed to, `email` is what the staff allow-list matches on.
 */
export type AdminRestUser = Readonly<{
  id: string;
  email?: string | null | undefined;
  impersonator?: AdminRestUser | undefined;
}>;

/**
 * The two session reads this family cannot perform for itself.
 *
 * `resolveActor` answers the application's own session shape; `resolveAuthSession`
 * answers the RAW auth row, whose id impersonation is started and stopped
 * against. They are separate ports because they are separate facts, and a
 * process that conflated them would start an impersonation against a session
 * that had already expired.
 */
export type AdminRestSessionPorts = Readonly<{
  resolveActor: (request: Request) => Promise<AdminRestActor | null>;
  resolveAuthSession: (request: Request) => Promise<Readonly<{ id: string }> | null>;
}>;

export type AdminRestPorts = Readonly<{
  /** A provider, so mounting the family does not construct the service. */
  ops: () => OpsApp;
  sessions: AdminRestSessionPorts;
}>;

const AUTH_REASON = "super-admin session validated in-handler via isAdmin";

const adminAuth = handlerManagedAuth({
  reason: AUTH_REASON,
  permissions: [],
  credential: "session",
});

/** The cookie is gone, so there is nobody to attach an impersonation to. */
class AdminSessionExpiredError extends HandledError {
  constructor() {
    super("unauthorized", "No active auth session for this admin request", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "AdminSessionExpiredError";
  }
}

class AdminMalformedBodyError extends HandledError {
  declare readonly code: "malformed_request";

  constructor() {
    super("malformed_request", "Admin request body must be a JSON object", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "AdminMalformedBodyError";
  }
}

export function createAdminRestApp(options: {
  security: AppRestSecurity;
  ports: AdminRestPorts;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({ basePath: "/api" });

  /**
   * The acting admin, or the refusal.
   *
   * `AdminSurfaceHiddenError` rather than a 403 for a non-admin: the whole
   * back-office is hidden from people who are not staff, so a probe learns
   * nothing about whether the surface exists.
   */
  const requireAdmin = async (request: Request) => {
    const session = await ports.sessions.resolveActor(request);
    const user = session?.user.impersonator ?? session?.user;
    const ops = ports.ops();
    if (!session || !user || !ops.isAdmin(user)) {
      throw new AdminSurfaceHiddenError();
    }
    return { ops, user };
  };

  const impersonate = async (c: Context, method: "POST" | "DELETE") => {
    const { ops, user } = await requireAdmin(c.req.raw);

    const authSession = await ports.sessions.resolveAuthSession(c.req.raw);
    if (!authSession) throw new AdminSessionExpiredError();

    if (method === "DELETE") {
      await ops.operations.stopImpersonation({ sessionId: authSession.id });
      return c.json({ message: "Impersonation ended" });
    }

    const body = await readJsonBody(c);
    const userIdToImpersonate = asNonEmptyString(body.userIdToImpersonate);
    const reason = asNonEmptyString(body.reason);
    if (!userIdToImpersonate || !reason) {
      const missing = [
        ...(userIdToImpersonate ? [] : ["userIdToImpersonate"]),
        ...(reason ? [] : ["reason"]),
      ];
      throw new ValidationError("Impersonation request is missing fields", {
        meta: {
          fieldErrors: Object.fromEntries(missing.map((field) => [field, ["This is required."]])),
        },
      });
    }

    await ops.operations.startImpersonation({
      sessionId: authSession.id,
      impersonatorUserId: user.id,
      userIdToImpersonate,
      reason,
      req: auditRequestFrom(c.req.raw),
    });
    return c.json({ message: "Impersonation started" });
  };

  secured.access(adminAuth).post("/admin/impersonate", (c) => impersonate(c, "POST"));
  secured.access(adminAuth).delete("/admin/impersonate", (c) => impersonate(c, "DELETE"));

  secured.access(adminAuth).post("/admin/:resource", async (c) => {
    const { ops, user } = await requireAdmin(c.req.raw);

    const body = await readJsonBody(c);
    // The BODY wins over the path parameter, because React Admin sends the
    // resource in both and the body is the one it computes from its own
    // registry. A mismatch is the client's, and it means the body.
    const resource = canonicalResource(body.resource ?? c.req.param("resource"));
    if (!resource) {
      throw new ValidationError("Unknown admin resource", {
        meta: {
          fieldErrors: { resource: ["This isn't a resource the admin API serves."] },
        },
      });
    }

    const parsed = adminOperationRequestSchema.safeParse({
      resource,
      method: body.method,
      params: body.params ?? {},
    });
    if (!parsed.success) {
      throw new ValidationError("Invalid admin operation", {
        meta: {
          fieldErrors: { method: ["This is not a supported admin operation."] },
        },
      });
    }

    const result = await ops.operations.adminOperation({
      ...parsed.data,
      actorId: user.id,
      req: auditRequestFrom(c.req.raw),
    });
    return c.json(result);
  });

  return secured.hono;
}

/** The plural spellings React Admin sends, mapped onto the model names. */
function canonicalResource(value: unknown) {
  if (typeof value !== "string") return null;
  const canonical =
    value === "organizations"
      ? "organization"
      : value === "subscriptions"
        ? "subscription"
        : value === "teams"
          ? "team"
          : value;
  const parsed = adminResourceNameSchema.safeParse(canonical);
  return parsed.success ? parsed.data : null;
}

async function readJsonBody(c: Context): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    throw new AdminMalformedBodyError();
  }
  if (!isRecord(parsed) || Array.isArray(parsed)) {
    throw new AdminMalformedBodyError();
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function auditRequestFrom(request: Request): AdminAuditRequest {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return { headers };
}
