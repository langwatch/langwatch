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

import {
  HandledError,
  NotFoundError,
  ValidationError,
} from "@langwatch/handled-error";
import { PlanTypes, type Prisma, SubscriptionStatus } from "@prisma/client";
import {
  defaultHandler,
  type GetListRequest,
  type GetOneRequest,
  getListHandler,
  getOneHandler,
} from "ra-data-simple-prisma";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { auditLog } from "~/server/auditLog";
import { getServerAuthSession } from "~/server/auth";
import { auth as betterAuth } from "~/server/better-auth";
import { prisma } from "~/server/db";
import { UserService } from "~/server/users/user.service";
import {
  mapUserToBackofficeRow,
  USER_BACKOFFICE_INCLUDE,
  type UserWithBackofficeIncludes,
} from "../backoffice/userVisibility";
import { ImpersonationService } from "../impersonation.service";
import { isAdmin } from "../isAdmin";
import { ORGANIZATION_SAFE_SELECT, PROJECT_SAFE_SELECT } from "../safeSelects";

const secured = createServiceApp({ basePath: "/api" });
const adminAuth = handlerManagedAuth(
  "super-admin session validated in-handler via isAdmin",
);

/**
 * The answer to "you are not an admin", which deliberately says nothing more.
 *
 * A 404 rather than a 403 so the admin surface doesn't confirm its own
 * existence to whoever is probing it, and the generic `not_found` code rather
 * than something naming the backoffice, for the same reason. It goes through
 * the handled channel anyway so the response carries a trace id — an operator
 * whose session quietly stopped being an admin has something to quote.
 */
function adminSurfaceHidden(): NotFoundError {
  return new NotFoundError("not_found", "Route", "/api/admin");
}

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

/**
 * The request body never parsed, so nothing was validated.
 *
 * A different failure from `ValidationError`'s 422: that one means we read the
 * document and disagreed with it. This one means there was no document, which
 * is a 400 and a code the client can recognise rather than the bare
 * `{ message: "Bad request" }` this route used to answer with.
 */
class AdminMalformedBodyError extends HandledError {
  declare readonly code: "malformed_request";

  constructor() {
    super("malformed_request", "Admin request body is not valid JSON", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "AdminMalformedBodyError";
  }
}

const ALLOWED_RESOURCES = new Set([
  "user",
  "organization",
  "organizations",
  "team",
  "teams",
  "project",
  "subscription",
  "subscriptions",
]);

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
  const sessionId = rawBetterAuth.session.id;

  // Adapt the real `auditLog` (typed with NextApiRequest) to the service's
  // structural `AuditLogFn`, which keeps Next/Hono types out of the service.
  const service = ImpersonationService.create(prisma, async (entry) =>
    auditLog({ ...entry, req: entry.req as any }),
  );

  if (method === "DELETE") {
    await service.stop({ sessionId });
    return c.json({ message: "Impersonation ended" });
  }

  const body = await readJsonBody(c);

  const { userIdToImpersonate, reason } = body;
  const missing = [
    ...(userIdToImpersonate ? [] : ["userIdToImpersonate"]),
    ...(reason ? [] : ["reason"]),
  ];
  if (missing.length > 0) {
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

/**
 * The request body, or a handled 400.
 *
 * Both admin routes parse a body the same way, and both used to answer an
 * unparseable one with a bare `{ message: "Bad request" }` — no code, so the
 * client had nothing to recognise and fell back to "we've been notified"
 * about a malformed request that will never repair itself.
 */
async function readJsonBody(c: any): Promise<Record<string, any>> {
  try {
    return (await c.req.json()) as Record<string, any>;
  } catch {
    throw new AdminMalformedBodyError();
  }
}

// ---------- POST /api/admin/:resource ----------
secured.access(adminAuth).post("/admin/:resource", async (c) => {
  const session = await getServerAuthSession({ req: c.req.raw as any });
  const user = session?.user.impersonator ?? session?.user;
  if (!session || !user || !isAdmin(user)) {
    throw adminSurfaceHidden();
  }

  const body = await readJsonBody(c);

  // The request body carries resource + method inside it, but the
  // URL also has the resource param. We use the body's resource field
  // since that's what defaultHandler expects.
  if (!body.resource) {
    body.resource = c.req.param("resource");
  }

  if (!ALLOWED_RESOURCES.has(body.resource)) {
    throw new ValidationError(
      `Unknown admin resource "${String(body.resource)}"`,
      {
        meta: {
          fieldErrors: {
            resource: ["This isn't a resource the admin API serves."],
          },
        },
      },
    );
  }

  if (body.resource === "organizations") body.resource = "organization";
  if (body.resource === "subscriptions") body.resource = "subscription";
  if (body.resource === "teams") body.resource = "team";

  if (body.resource === "user" && body.method === "getList") {
    const query = body.params?.filter?.query;
    if (body.params?.filter?.query) delete body.params.filter.query;

    const result = await getListHandler<Prisma.UserFindManyArgs>(
      body as GetListRequest,
      prisma.user,
      {
        ...(query
          ? {
              where: {
                OR: [
                  // ID: prefix/contains so operators can paste the full id or
                  // a leading fragment (e.g. "user_abc") and still hit it.
                  { id: { contains: query, mode: "insensitive" } },
                  { name: { contains: query, mode: "insensitive" } },
                  { email: { contains: query, mode: "insensitive" } },
                  {
                    orgMemberships: {
                      some: {
                        organization: {
                          OR: [
                            { id: { contains: query, mode: "insensitive" } },
                            {
                              name: {
                                contains: query,
                                mode: "insensitive",
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                  {
                    // Mirror the main app's project-visibility rule
                    // (org membership → org.teams → team.projects). A user
                    // should be searchable by any project they can see in
                    // the project switcher, even without a TeamUser row.
                    orgMemberships: {
                      some: {
                        organization: {
                          teams: {
                            some: {
                              projects: {
                                some: {
                                  OR: [
                                    {
                                      id: {
                                        contains: query,
                                        mode: "insensitive",
                                      },
                                    },
                                    {
                                      name: {
                                        contains: query,
                                        mode: "insensitive",
                                      },
                                    },
                                  ],
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            }
          : {}),
        include: USER_BACKOFFICE_INCLUDE,
        map: (users: UserWithBackofficeIncludes[]) =>
          users.map(mapUserToBackofficeRow),
      },
    );
    return c.json(result);
  }

  if (body.resource === "organization" && body.method === "getList") {
    const query = body.params?.filter?.query;
    if (body.params?.filter?.query) delete body.params.filter.query;

    const result = await getListHandler<Prisma.OrganizationFindManyArgs>(
      body as GetListRequest,
      prisma.organization,
      {
        select: ORGANIZATION_SAFE_SELECT,
        ...(query
          ? {
              where: {
                OR: [
                  { id: { contains: query, mode: "insensitive" } },
                  { name: { contains: query, mode: "insensitive" } },
                  { slug: { contains: query, mode: "insensitive" } },
                ],
              },
            }
          : {}),
      },
    );
    return c.json(result);
  }

  // Single-org detail fetch used by the edit drawer — same safe select as
  // the list, so credentials never reach the admin UI.
  if (body.resource === "organization" && body.method === "getOne") {
    const result = await getOneHandler<Prisma.OrganizationFindUniqueArgs>(
      body as GetOneRequest,
      prisma.organization,
      { select: ORGANIZATION_SAFE_SELECT },
    );
    return c.json(result);
  }

  if (body.resource === "project" && body.method === "getList") {
    const query = body.params?.filter?.query;
    if (body.params?.filter?.query) delete body.params.filter.query;

    const result = await getListHandler<Prisma.ProjectFindManyArgs>(
      body as GetListRequest,
      prisma.project,
      {
        select: PROJECT_SAFE_SELECT,
        ...(query
          ? {
              where: {
                OR: [
                  { id: { contains: query, mode: "insensitive" } },
                  { name: { contains: query, mode: "insensitive" } },
                  { slug: { contains: query, mode: "insensitive" } },
                ],
              },
            }
          : {}),
      },
    );
    return c.json(result);
  }

  if (body.resource === "project" && body.method === "getOne") {
    const result = await getOneHandler<Prisma.ProjectFindUniqueArgs>(
      body as GetOneRequest,
      prisma.project,
      { select: PROJECT_SAFE_SELECT },
    );
    return c.json(result);
  }

  // Admin user updates with side effects
  if (
    body.resource === "user" &&
    body.method === "update" &&
    body.params?.id &&
    body.params?.data
  ) {
    const userId = String(body.params.id);
    const data = body.params.data as Record<string, unknown>;
    const userService = UserService.create(prisma);
    let handledSideEffect = false;
    const sideEffectAudit: Array<{
      action: string;
      payload: object;
    }> = [];

    if ("deactivatedAt" in data) {
      const v = data.deactivatedAt;
      if (v === null || v === "") {
        await userService.reactivate({ id: userId });
        delete data.deactivatedAt;
        handledSideEffect = true;
        sideEffectAudit.push({
          action: "update/user",
          payload: { id: userId, reactivate: true },
        });
      } else if (typeof v === "string" || v instanceof Date) {
        await userService.deactivate({ id: userId });
        delete data.deactivatedAt;
        handledSideEffect = true;
        const pickedDate = v instanceof Date ? v : new Date(v);
        const isValidPickedDate = !Number.isNaN(pickedDate.getTime());
        if (isValidPickedDate) {
          await prisma.user.update({
            where: { id: userId },
            data: { deactivatedAt: pickedDate },
          });
        }
        sideEffectAudit.push({
          action: "update/user",
          payload: {
            id: userId,
            deactivate: true,
            ...(isValidPickedDate
              ? { pickedDate: pickedDate.toISOString() }
              : {}),
          },
        });
      }
    }

    if ("email" in data && typeof data.email === "string") {
      const newEmail = data.email.trim().toLowerCase();
      await userService.updateProfile({ id: userId, email: newEmail });
      delete data.email;
      handledSideEffect = true;
      sideEffectAudit.push({
        action: "update/user",
        payload: { id: userId, email: newEmail },
      });
    }

    for (const entry of sideEffectAudit) {
      await auditLog({
        userId: user.id,
        action: `admin/${entry.action}`,
        args: entry.payload,
        req: c.req.raw as any,
      });
    }

    if (handledSideEffect && Object.keys(data).length === 0) {
      const updated = await prisma.user.findUnique({
        where: { id: userId },
      });
      return c.json({ data: updated });
    }
  }

  // Normalize ssoDomain to lowercase
  if (
    body.resource === "organization" &&
    (body.method === "create" || body.method === "update")
  ) {
    const params = body.params as
      | { data?: { ssoDomain?: string | null } }
      | undefined;
    const ssoDomain = params?.data?.ssoDomain;
    if (typeof ssoDomain === "string" && ssoDomain.trim() !== "") {
      params!.data!.ssoDomain = ssoDomain.trim().toLowerCase();
    }
  }

  if (body.resource === "subscription" && body.method === "getList") {
    const query = body.params?.filter?.query;
    if (body.params?.filter?.query) delete body.params.filter.query;

    const upperQuery = query?.toUpperCase();
    const matchingPlan = upperQuery
      ? Object.values(PlanTypes).find((p) => p === upperQuery)
      : undefined;
    const matchingStatus = upperQuery
      ? Object.values(SubscriptionStatus).find((s) => s === upperQuery)
      : undefined;

    const orFilters: Prisma.SubscriptionWhereInput[] = [];
    if (query) {
      orFilters.push({
        id: { contains: query, mode: "insensitive" },
      });
      orFilters.push({
        stripeSubscriptionId: {
          contains: query,
          mode: "insensitive",
        },
      });
      orFilters.push({
        organization: {
          OR: [
            { id: { contains: query, mode: "insensitive" } },
            { name: { contains: query, mode: "insensitive" } },
            { slug: { contains: query, mode: "insensitive" } },
          ],
        },
      });
      if (matchingPlan) orFilters.push({ plan: { equals: matchingPlan } });
      if (matchingStatus)
        orFilters.push({ status: { equals: matchingStatus } });
    }

    const result = await getListHandler<Prisma.SubscriptionFindManyArgs>(
      body as GetListRequest,
      prisma.subscription,
      {
        where: orFilters.length > 0 ? { OR: orFilters } : {},
        include: {
          organization: {
            select: { id: true, name: true, slug: true },
          },
        },
      },
    );
    return c.json(result);
  }

  const result = await defaultHandler(body as any, prisma as any, {
    audit: {
      model: {
        create: async ({
          data,
        }: {
          data: {
            action: string;
            resource: string;
            payload: object;
            author: { connect: { id: string } };
          };
        }) => {
          await auditLog({
            userId: data.author.connect.id,
            action: `admin/${data.action}/${data.resource}`,
            args: data.payload,
            req: c.req.raw as any,
          });
        },
      },
      authProvider: {
        getIdentity: async () => ({
          id: user?.id ?? session?.user.id,
          fullName: user?.name ?? session?.user.name,
        }),
      } as any,
    },
  });

  return c.json(result);
});

export const app = secured.hono;
