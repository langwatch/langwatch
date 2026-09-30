/**
 * Hono routes for the Backoffice admin endpoints.
 *
 * Lives under `ee/admin/routes/` so the whole admin surface — routes,
 * services, client, React views — is consolidated under the `ee/` boundary
 * instead of leaking admin-only code back into `src/server/routes/`.
 *
 * Mounted by `src/server/api-router.ts`. Exposes:
 *   - POST|DELETE /api/admin/impersonate
 *   - POST        /api/admin/:resource   (ra-data-simple-prisma)
 */

import { auditLog } from "@ee/audit-log/auditLog";
import { HandledError, ValidationError } from "@langwatch/handled-error";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { identityEmail } from "~/server/app-layer/identity/runtime";
import { getServerAuthSession } from "~/server/auth";
import { auth as betterAuth } from "~/server/better-auth";
import { prisma } from "~/server/db";
import { adminSurfaceHidden } from "../adminSurfaceHidden";
import { ImpersonationService } from "../impersonation.service";
import { isAdmin } from "../isAdmin";
import { asNonEmptyString, readJsonBody } from "./admin-request";
import { handleAdminResource } from "./admin-resource";

const secured = createServiceApp({ basePath: "/api" });
const adminAuth = handlerManagedAuth({
  reason: "super-admin session validated in-handler via isAdmin",
  // Gated by super-admin identity, not by an RBAC permission.
  permissions: [],
  credential: "session",
});

/**
 * The caller has an app session but no live auth session behind it.
 *
 * Known cause, and the customer can act on it — sign in again — which is
 * exactly what the registry's `unauthorized` copy says. Not a 500.
 */
class AdminSessionExpiredError extends HandledError {
  constructor() {
    super("unauthorized", "No active auth session for this admin request", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "AdminSessionExpiredError";
  }
}

// ---------- POST|DELETE /api/admin/impersonate ----------
//
// Both verbs share the same admin guard + BetterAuth session lookup, so we
// route them through a single helper and let the service do the real work.
// The service throws `HandledError` subclasses for business-rule rejections;
// they travel untouched to `createServiceApp`'s `onError`, which is the one
// place that serialises them — code, meta, tips, docs link and trace id.

secured
  .access(adminAuth)
  .post("/admin/impersonate", async (c) => handleImpersonate(c, "POST"));
secured
  .access(adminAuth)
  .delete("/admin/impersonate", async (c) => handleImpersonate(c, "DELETE"));

async function handleImpersonate(c: any, method: "POST" | "DELETE") {
  const { user, sessionId } = await impersonationContext(c);

  // Adapt the real `auditLog` (typed with NextApiRequest) to the service's
  // structural `AuditLogFn`, which keeps Next/Hono types out of the service.
  const service = ImpersonationService.create(
    prisma,
    async (entry) => auditLog({ ...entry, req: entry.req as any }),
    // The same fork `getServerAuthSession` resolves the session's own address
    // through, so the admin gate on this route and the admin guard inside the
    // service are reading one answer rather than two.
    ({ userId }) => identityEmail().resolveEmail({ userId }),
  );

  if (method === "DELETE") {
    await service.stop({ sessionId });
    return c.json({ message: "Impersonation ended" });
  }

  const body = await readJsonBody(c);

  // `readJsonBody` guarantees an object, not the shape of one — a caller can
  // still send `{ reason: 12 }`. Both fields are required strings downstream,
  // so anything else is reported as missing rather than handed on.
  const userIdToImpersonate = asNonEmptyString(body.userIdToImpersonate);
  const reason = asNonEmptyString(body.reason);
  if (!userIdToImpersonate || !reason) {
    const missing = [
      ...(userIdToImpersonate ? [] : ["userIdToImpersonate"]),
      ...(reason ? [] : ["reason"]),
    ];
    throw new ValidationError("Impersonation request is missing fields", {
      // `fieldErrors` is the validation_error contract the client reads —
      // `applyHandledErrorToForm` puts each one on its own input.
      meta: {
        fieldErrors: Object.fromEntries(
          missing.map((field) => [field, ["This is required."]]),
        ),
      },
    });
  }

  // No catch: a `HandledError` from the service reaches `onError` unchanged,
  // which serialises the whole payload. Catching it here to re-emit
  // `{ message }` threw away the code, the meta and the trace id — leaving
  // the client with a sentence it is not allowed to render.
  await service.start({
    sessionId,
    impersonatorUserId: user.id,
    userIdToImpersonate,
    reason,
    req: c.req.raw,
  });

  return c.json({ message: "Impersonation started" });
}

async function impersonationContext(c: any) {
  const session = await getServerAuthSession({ req: c.req.raw as any });
  const user = session?.user.impersonator ?? session?.user;

  if (!session || !user || !isAdmin(user)) {
    throw adminSurfaceHidden();
  }

  const rawHeaders = new Headers();
  for (const [k, v] of c.req.raw.headers.entries()) {
    rawHeaders.append(k, v);
  }
  const rawBetterAuth = await betterAuth.api.getSession({
    headers: rawHeaders,
  });
  if (!rawBetterAuth) {
    throw new AdminSessionExpiredError();
  }
  return { user, sessionId: rawBetterAuth.session.id };
}

// ---------- POST /api/admin/:resource ----------
secured.access(adminAuth).post("/admin/:resource", handleAdminResource);

export const app = secured.hono;
