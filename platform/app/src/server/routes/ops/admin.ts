/**
 * App-owned Ops transport for the backoffice endpoints.
 *
 * The Ops service owns validation of the resource operation, Prisma/React
 * Admin compatibility, safe selects, mutations, and audit writes. This file
 * only owns HTTP auth, body parsing, URL aliases, and the existing wire shape.
 *
 * Mounted by `src/server/api-router.ts`:
 *   - POST|DELETE /api/admin/impersonate
 *   - POST        /api/admin/:resource
 */

import {
  AdminSurfaceHiddenError,
  adminOperationRequestSchema,
  adminResourceNameSchema,
  type AdminAuditRequest,
} from "@langwatch/ops-contract";
import { HandledError, ValidationError } from "@langwatch/handled-error";
import type { Context } from "hono";
import { createServiceApp } from "~/server/api/security";
import { handlerManagedAuth } from "@langwatch/platform-api/app-rest";
import { getServerAuthSession } from "~/server/auth";

import type { AppContextBindings, AppContextVariables } from "~/app/api/middleware/app-context";

type AdminEnv = {
  Bindings: AppContextBindings;
  Variables: AppContextVariables;
};
type AdminContext = Context<AdminEnv>;

const secured = createServiceApp<AdminEnv>({
  basePath: "/api",
});
const adminAuth = handlerManagedAuth({
  reason: "super-admin session validated in-handler via isAdmin",
  permissions: [],
  credential: "session",
});

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

secured.access(adminAuth).post("/admin/impersonate", async (c) => handleImpersonate(c, "POST"));
secured.access(adminAuth).delete("/admin/impersonate", async (c) => handleImpersonate(c, "DELETE"));

async function handleImpersonate(c: AdminContext, method: "POST" | "DELETE") {
  const session = await getServerAuthSession({ app: c.app, req: c.req.raw });
  const user = session?.user.impersonator ?? session?.user;
  const ops = c.app.ops;

  if (!session || !user || !ops.isAdmin(user)) {
    throw new AdminSurfaceHiddenError();
  }

  const rawHeaders = new Headers();
  for (const [name, value] of c.req.raw.headers.entries()) {
    rawHeaders.append(name, value);
  }
  const rawBetterAuth = await c.app.betterAuth.api.getSession({
    headers: rawHeaders,
  });
  if (!rawBetterAuth) throw new AdminSessionExpiredError();

  if (method === "DELETE") {
    await ops.stopImpersonation({ sessionId: rawBetterAuth.session.id });
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

  await ops.startImpersonation({
    sessionId: rawBetterAuth.session.id,
    impersonatorUserId: user.id,
    userIdToImpersonate,
    reason,
    req: auditRequestFrom(c.req.raw),
  });
  return c.json({ message: "Impersonation started" });
}

secured.access(adminAuth).post("/admin/:resource", async (c: AdminContext) => {
  const session = await getServerAuthSession({ app: c.app, req: c.req.raw });
  const user = session?.user.impersonator ?? session?.user;
  const ops = c.app.ops;
  if (!session || !user || !ops.isAdmin(user)) {
    throw new AdminSurfaceHiddenError();
  }

  const body = await readJsonBody(c);
  const resource = canonicalResource(body.resource ?? c.req.param("resource"));
  if (!resource) {
    throw new ValidationError("Unknown admin resource", {
      meta: {
        fieldErrors: {
          resource: ["This isn't a resource the admin API serves."],
        },
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
        fieldErrors: {
          method: ["This is not a supported admin operation."],
        },
      },
    });
  }

  const result = await ops.adminOperation({
    ...parsed.data,
    actorId: user.id,
    req: auditRequestFrom(c.req.raw),
  });
  return c.json(result);
});

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

async function readJsonBody(c: AdminContext): Promise<Record<string, unknown>> {
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

export const app = secured.hono;
