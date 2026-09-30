import { auditLog } from "@ee/audit-log/auditLog";
import { ValidationError } from "@langwatch/handled-error";
import type { Context } from "hono";
import {
  defaultHandler,
  type GetListRequest,
  type GetOneRequest,
  getListHandler,
  getOneHandler,
} from "ra-data-simple-prisma";
import {
  PlanTypes,
  type Prisma,
  SubscriptionStatus,
} from "~/generated/prisma/client";
import { assertLegacySsoStringWriteAllowed } from "~/server/app-layer/identity/legacy-sso-string-writes";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { UserService } from "~/server/users/user.service";
import { adminSurfaceHidden } from "../adminSurfaceHidden";
import {
  mapUserToBackofficeRow,
  USER_BACKOFFICE_INCLUDE,
  type UserWithBackofficeIncludes,
} from "../backoffice/userVisibility";
import { isAdmin } from "../isAdmin";
import { ORGANIZATION_SAFE_SELECT, PROJECT_SAFE_SELECT } from "../safeSelects";
import { type AdminDataRequest, asRecord, readJsonBody } from "./admin-request";

const RESOURCE_ALIASES = {
  organization: "organization",
  organizations: "organization",
  project: "project",
  subscription: "subscription",
  subscriptions: "subscription",
  team: "team",
  teams: "team",
  user: "user",
} as const;

type AdminResource = (typeof RESOURCE_ALIASES)[keyof typeof RESOURCE_ALIASES];
type AdminUser = {
  id: string;
  name?: string | null;
  email?: string | null;
};

export async function handleAdminResource(c: Context): Promise<Response> {
  const session = await getServerAuthSession({ req: c.req.raw as any });
  const user = session?.user.impersonator ?? session?.user;
  if (!session || !user || !isAdmin(user)) {
    throw adminSurfaceHidden();
  }

  const body = (await readJsonBody(c)) as AdminDataRequest;
  const resource = normalizeResource(body, c.req.param("resource"));
  return dispatchResource({ c, body, resource, user });
}

function normalizeResource(
  body: AdminDataRequest,
  urlResource: string | undefined,
): AdminResource {
  const requested = body.resource || urlResource;
  if (
    typeof requested !== "string" ||
    !Object.hasOwn(RESOURCE_ALIASES, requested)
  ) {
    throw new ValidationError("Unknown admin resource", {
      meta: {
        fieldErrors: {
          resource: ["This isn't a resource the admin API serves."],
        },
      },
    });
  }
  const resource = RESOURCE_ALIASES[requested as keyof typeof RESOURCE_ALIASES];
  body.resource = resource;
  return resource;
}

async function dispatchResource({
  c,
  body,
  resource,
  user,
}: {
  c: Context;
  body: AdminDataRequest;
  resource: AdminResource;
  user: AdminUser;
}): Promise<Response> {
  switch (resource) {
    case "user":
      return handleUserResource(c, body, user);
    case "organization":
      return handleOrganizationResource(c, body, user);
    case "project":
      return handleProjectResource(c, body, user);
    case "subscription":
      return handleSubscriptionResource(c, body, user);
    case "team":
      return handleDefaultResource(c, body, user);
  }
}

async function handleUserResource(
  c: Context,
  body: AdminDataRequest,
  user: AdminUser,
): Promise<Response> {
  if (body.method === "getList") return listUsers(c, body);

  if (body.method === "update") {
    const sideEffectResponse = await handleUserSideEffects(c, body, user);
    if (sideEffectResponse) return sideEffectResponse;
  }

  return handleDefaultResource(c, body, user);
}

async function handleOrganizationResource(
  c: Context,
  body: AdminDataRequest,
  user: AdminUser,
): Promise<Response> {
  if (body.method === "getList") return listOrganizations(c, body);
  if (body.method === "getOne") return getOrganization(c, body);

  await guardLegacySsoStringWrites(body);
  return handleDefaultResource(c, body, user);
}

async function handleProjectResource(
  c: Context,
  body: AdminDataRequest,
  user: AdminUser,
): Promise<Response> {
  if (body.method === "getList") return listProjects(c, body);
  if (body.method === "getOne") return getProject(c, body);
  return handleDefaultResource(c, body, user);
}

async function handleSubscriptionResource(
  c: Context,
  body: AdminDataRequest,
  user: AdminUser,
): Promise<Response> {
  if (body.method === "getList") return listSubscriptions(c, body);
  return handleDefaultResource(c, body, user);
}

async function listUsers(
  c: Context,
  body: AdminDataRequest,
): Promise<Response> {
  const query = takeQuery(body);
  const result = await getListHandler<Prisma.UserFindManyArgs>(
    body as GetListRequest,
    prisma.user,
    {
      ...(query ? { where: userSearch(query) } : {}),
      include: USER_BACKOFFICE_INCLUDE,
      map: (users: UserWithBackofficeIncludes[]) =>
        users.map(mapUserToBackofficeRow),
    },
  );
  return c.json(result);
}

function userSearch(query: string): Prisma.UserWhereInput {
  return {
    OR: [
      { id: { contains: query, mode: "insensitive" } },
      { name: { contains: query, mode: "insensitive" } },
      { email: { contains: query, mode: "insensitive" } },
      {
        orgMemberships: {
          some: {
            organization: {
              OR: [
                { id: { contains: query, mode: "insensitive" } },
                { name: { contains: query, mode: "insensitive" } },
              ],
            },
          },
        },
      },
      {
        orgMemberships: {
          some: {
            organization: {
              teams: {
                some: {
                  projects: {
                    some: {
                      OR: [
                        { id: { contains: query, mode: "insensitive" } },
                        { name: { contains: query, mode: "insensitive" } },
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
  };
}

async function listOrganizations(
  c: Context,
  body: AdminDataRequest,
): Promise<Response> {
  const query = takeQuery(body);
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

async function getOrganization(
  c: Context,
  body: AdminDataRequest,
): Promise<Response> {
  const result = await getOneHandler<Prisma.OrganizationFindUniqueArgs>(
    body as GetOneRequest,
    prisma.organization,
    { select: ORGANIZATION_SAFE_SELECT },
  );
  return c.json(result);
}

async function listProjects(
  c: Context,
  body: AdminDataRequest,
): Promise<Response> {
  const query = takeQuery(body);
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

async function getProject(
  c: Context,
  body: AdminDataRequest,
): Promise<Response> {
  const result = await getOneHandler<Prisma.ProjectFindUniqueArgs>(
    body as GetOneRequest,
    prisma.project,
    { select: PROJECT_SAFE_SELECT },
  );
  return c.json(result);
}

async function handleUserSideEffects(
  c: Context,
  body: AdminDataRequest,
  user: AdminUser,
): Promise<Response | null> {
  const requestedUserId = body.params?.id;
  const data = asRecord(body.params?.data);
  if (!requestedUserId || !data) return null;
  const userId = String(requestedUserId);

  const userService = UserService.create(prisma);
  let handledSideEffect = false;
  const sideEffectAudit: Array<{ action: string; payload: object }> = [];
  await applyDeactivation({
    data,
    userId,
    userService,
    audit: sideEffectAudit,
  });
  if ("deactivatedAt" in data) handledSideEffect = true;
  await applyEmail({
    data,
    userId,
    userService,
    audit: sideEffectAudit,
  });
  if (sideEffectAudit.length > 0) handledSideEffect = true;

  for (const entry of sideEffectAudit) {
    await auditLog({
      userId: user.id,
      action: `admin/${entry.action}`,
      args: entry.payload,
      req: c.req.raw as any,
    });
  }

  if (!handledSideEffect || Object.keys(data).length > 0) return null;
  const updated = await prisma.user.findUnique({ where: { id: userId } });
  return c.json({ data: updated });
}

async function applyDeactivation({
  data,
  userId,
  userService,
  audit,
}: {
  data: Record<string, unknown>;
  userId: string;
  userService: UserService;
  audit: Array<{ action: string; payload: object }>;
}): Promise<void> {
  if (!("deactivatedAt" in data)) return;
  const value = data.deactivatedAt;
  if (value === null || value === "") {
    await userService.reactivate({ id: userId });
    delete data.deactivatedAt;
    audit.push({
      action: "update/user",
      payload: { id: userId, reactivate: true },
    });
    return;
  }
  if (typeof value !== "string" && !(value instanceof Date)) return;

  await userService.deactivate({ id: userId });
  delete data.deactivatedAt;
  const pickedDate = value instanceof Date ? value : new Date(value);
  const validDate = !Number.isNaN(pickedDate.getTime());
  if (validDate) {
    await prisma.user.update({
      where: { id: userId },
      data: { deactivatedAt: pickedDate },
    });
  }
  audit.push({
    action: "update/user",
    payload: {
      id: userId,
      deactivate: true,
      ...(validDate ? { pickedDate: pickedDate.toISOString() } : {}),
    },
  });
}

async function applyEmail({
  data,
  userId,
  userService,
  audit,
}: {
  data: Record<string, unknown>;
  userId: string;
  userService: UserService;
  audit: Array<{ action: string; payload: object }>;
}): Promise<void> {
  if (typeof data.email !== "string") return;
  const email = data.email.trim().toLowerCase();
  await userService.updateProfile({ id: userId, email });
  delete data.email;
  audit.push({ action: "update/user", payload: { id: userId, email } });
}

async function listSubscriptions(
  c: Context,
  body: AdminDataRequest,
): Promise<Response> {
  const query = takeQuery(body);
  const upperQuery = query?.toUpperCase();
  const matchingPlan = upperQuery
    ? Object.values(PlanTypes).find((plan) => plan === upperQuery)
    : undefined;
  const matchingStatus = upperQuery
    ? Object.values(SubscriptionStatus).find((status) => status === upperQuery)
    : undefined;
  const orFilters: Prisma.SubscriptionWhereInput[] = query
    ? [
        { id: { contains: query, mode: "insensitive" } },
        { stripeSubscriptionId: { contains: query, mode: "insensitive" } },
        {
          organization: {
            OR: [
              { id: { contains: query, mode: "insensitive" } },
              { name: { contains: query, mode: "insensitive" } },
              { slug: { contains: query, mode: "insensitive" } },
            ],
          },
        },
        ...(matchingPlan ? [{ plan: { equals: matchingPlan } }] : []),
        ...(matchingStatus ? [{ status: { equals: matchingStatus } }] : []),
      ]
    : [];
  const result = await getListHandler<Prisma.SubscriptionFindManyArgs>(
    body as GetListRequest,
    prisma.subscription,
    {
      where: orFilters.length > 0 ? { OR: orFilters } : {},
      include: {
        organization: { select: { id: true, name: true, slug: true } },
      },
    },
  );
  return c.json(result);
}

function takeQuery(body: AdminDataRequest): string | undefined {
  const query = body.params?.filter?.query;
  if (typeof query !== "string" || query === "") return undefined;
  delete body.params?.filter?.query;
  return query;
}

async function guardLegacySsoStringWrites(
  body: AdminDataRequest,
): Promise<void> {
  if (
    body.resource !== "organization" ||
    (body.method !== "create" && body.method !== "update")
  ) {
    return;
  }
  const params = body.params;
  const data = asRecord(params?.data);
  const organizationId =
    body.method === "update" && typeof params?.id === "string"
      ? params.id
      : null;
  await assertLegacySsoStringWriteAllowed({
    organizationId,
    data,
    hasConnection: async ({ organizationId: id }) =>
      (await prisma.ssoConnection.count({ where: { organizationId: id } })) > 0,
  });
  const ssoDomain = data?.ssoDomain;
  if (data && typeof ssoDomain === "string" && ssoDomain.trim() !== "") {
    data.ssoDomain = ssoDomain.trim().toLowerCase();
  }
}

async function handleDefaultResource(
  c: Context,
  body: AdminDataRequest,
  user: AdminUser,
): Promise<Response> {
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
          id: user.id,
          fullName: user.name,
        }),
      } as any,
    },
  });
  return c.json(result);
}
