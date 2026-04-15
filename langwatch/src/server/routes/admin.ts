/**
 * Hono routes for admin endpoints.
 *
 * Replaces:
 * - src/pages/api/admin/impersonate.ts
 * - src/pages/api/admin/[resource].ts
 */
import {
  defaultHandler,
  getListHandler,
  type GetListRequest,
} from "ra-data-simple-prisma";
import { Prisma, PlanTypes, SubscriptionStatus } from "@prisma/client";
import type { Organization, Project, Team, User } from "@prisma/client";
import { Hono } from "hono";
import { auth as betterAuth } from "~/server/better-auth";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { isAdmin } from "../../../ee/admin/isAdmin";
import { auditLog } from "~/server/auditLog";
import { UserService } from "~/server/users/user.service";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:admin");

export const app = new Hono().basePath("/api");

const ALLOWED_RESOURCES = new Set([
  "user",
  "organization",
  "organizations",
  "team",
  "teams",
  "project",
  "subscription",
  "subscriptions",
  "organizationFeature",
  "organizationFeatures",
]);

// ---------- POST|DELETE /api/admin/impersonate ----------
app.post("/admin/impersonate", async (c) => {
  return handleImpersonate(c, "POST");
});

app.delete("/admin/impersonate", async (c) => {
  return handleImpersonate(c, "DELETE");
});

async function handleImpersonate(c: any, method: "POST" | "DELETE") {
  const session = await getServerAuthSession({ req: c.req.raw as any });
  const user = session?.user.impersonator ?? session?.user;

  if (!session || !user || !isAdmin(user)) {
    return c.json({ message: "Not Found" }, 404);
  }

  const rawHeaders = new Headers();
  for (const [k, v] of c.req.raw.headers.entries()) {
    rawHeaders.append(k, v);
  }
  const rawBetterAuth = await betterAuth.api.getSession({
    headers: rawHeaders,
  });
  if (!rawBetterAuth) {
    return c.json({ message: "Unauthorized" }, 401);
  }
  const sessionId = rawBetterAuth.session.id;

  if (method === "POST") {
    let body: Record<string, any>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ message: "Bad request" }, 400);
    }

    const { userIdToImpersonate, reason } = body;
    if (!userIdToImpersonate || !reason) {
      return c.json({ message: "Missing required fields" }, 400);
    }

    const userToImpersonate = await prisma.user.findUnique({
      where: { id: userIdToImpersonate },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        deactivatedAt: true,
      },
    });

    if (!userToImpersonate) {
      return c.json({ message: "User to impersonate not found" }, 404);
    }

    if (userToImpersonate.deactivatedAt) {
      return c.json(
        { message: "Cannot impersonate a deactivated user" },
        400,
      );
    }

    if (isAdmin(userToImpersonate)) {
      return c.json(
        { message: "Cannot impersonate another admin" },
        403,
      );
    }

    await auditLog({
      userId: user.id,
      action: "admin/impersonate",
      args: { userIdToImpersonate: userToImpersonate.id, reason },
      req: c.req.raw as any,
    });

    await prisma.session.update({
      where: { id: sessionId },
      data: {
        impersonating: {
          id: userToImpersonate.id,
          name: userToImpersonate.name,
          email: userToImpersonate.email,
          image: userToImpersonate.image,
          expires: new Date(Date.now() + 1000 * 60 * 60),
        },
      },
    });

    return c.json({ message: "Impersonation started" });
  } else {
    await prisma.session.update({
      where: { id: sessionId },
      data: { impersonating: Prisma.DbNull },
    });

    return c.json({ message: "Impersonation ended" });
  }
}

// ---------- POST /api/admin/:resource ----------
app.post("/admin/:resource", async (c) => {
  const session = await getServerAuthSession({ req: c.req.raw as any });
  const user = session?.user.impersonator ?? session?.user;
  if (!session || !user || !isAdmin(user)) {
    logger.warn(
      {
        hasSession: !!session,
        userEmail: user?.email ?? null,
        adminEmailsConfigured: !!process.env.ADMIN_EMAILS,
      },
      "admin access denied",
    );
    return c.json({ message: "Not Found" }, 404);
  }

  let body: Record<string, any>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ message: "Bad request" }, 400);
  }

  // The react-admin body comes with resource + method inside it, but the
  // URL also has the resource param. We use the body's resource field
  // since that's what defaultHandler expects.
  if (!body.resource) {
    body.resource = c.req.param("resource");
  }

  if (!ALLOWED_RESOURCES.has(body.resource)) {
    return c.json({ message: "Unknown resource" }, 400);
  }

  if (body.resource === "organizations") body.resource = "organization";
  if (body.resource === "organizationFeatures")
    body.resource = "organizationFeature";
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
                  { name: { contains: query, mode: "insensitive" } },
                  { email: { contains: query, mode: "insensitive" } },
                  {
                    orgMemberships: {
                      some: {
                        organization: {
                          name: {
                            contains: query,
                            mode: "insensitive",
                          },
                        },
                      },
                    },
                  },
                  {
                    teamMemberships: {
                      some: {
                        team: {
                          projects: {
                            some: {
                              name: {
                                contains: query,
                                mode: "insensitive",
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
        include: {
          orgMemberships: { include: { organization: true } },
          teamMemberships: {
            include: { team: { include: { projects: true } } },
          },
        },
        map: (
          users: (User & {
            orgMemberships: { organization: Organization }[];
            teamMemberships: {
              team: Team & { projects: Project[] };
            }[];
          })[],
        ) =>
          users.map((u) => ({
            ...u,
            organizations: u.orgMemberships
              ?.map((om) => om.organization.name)
              .join(", "),
            teams: u.teamMemberships
              ?.map((tm) => tm.team.name)
              .join(", "),
            projects: u.teamMemberships
              ?.flatMap((tm) =>
                tm.team.projects?.map((p) => p.name),
              )
              .join(", "),
          })),
      },
    );
    return c.json(result);
  }

  if (
    body.resource === "organization" &&
    body.method === "getList"
  ) {
    const query = body.params?.filter?.query;
    if (body.params?.filter?.query) delete body.params.filter.query;

    const result = await getListHandler<Prisma.OrganizationFindManyArgs>(
      body as GetListRequest,
      prisma.organization,
      {
        ...(query
          ? {
              where: {
                OR: [
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

  if (body.resource === "project" && body.method === "getList") {
    const query = body.params?.filter?.query;
    if (body.params?.filter?.query) delete body.params.filter.query;

    const result = await getListHandler<Prisma.ProjectFindManyArgs>(
      body as GetListRequest,
      prisma.project,
      {
        ...(query
          ? {
              where: {
                OR: [
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

  if (
    body.resource === "subscription" &&
    body.method === "getList"
  ) {
    const query = body.params?.filter?.query;
    if (body.params?.filter?.query) delete body.params.filter.query;

    const upperQuery = query?.toUpperCase();
    const matchingPlan = upperQuery
      ? Object.values(PlanTypes).find((p) => p === upperQuery)
      : undefined;
    const matchingStatus = upperQuery
      ? Object.values(SubscriptionStatus).find(
          (s) => s === upperQuery,
        )
      : undefined;

    const orFilters: Prisma.SubscriptionWhereInput[] = [];
    if (query) {
      orFilters.push({
        stripeSubscriptionId: {
          contains: query,
          mode: "insensitive",
        },
      });
      orFilters.push({
        organization: {
          name: { contains: query, mode: "insensitive" },
        },
      });
      if (matchingPlan)
        orFilters.push({ plan: { equals: matchingPlan } });
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
