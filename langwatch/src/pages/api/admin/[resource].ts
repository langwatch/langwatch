import {
  defaultHandler,
  getListHandler,
  type GetListRequest,
} from "ra-data-simple-prisma";
import { prisma } from "~/server/db";
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerAuthSession } from "~/server/auth";
import { UserService } from "~/server/users/user.service";
import { isAdmin } from "../../../../ee/admin/isAdmin";
import { auditLog } from "~/server/auditLog";
import { PlanTypes, SubscriptionStatus } from "@prisma/client";
import type { Organization, Prisma, Project, Team, User } from "@prisma/client";

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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerAuthSession({ req, res });
  // When impersonating, `session.user` is the target user and
  // `session.user.impersonator` is the real admin. Permission checks
  // ALWAYS use the impersonator's identity so admin actions aren't
  // silently routed through the impersonated user's permissions.
  const user = session?.user.impersonator ?? session?.user;
  if (!session || !user || !isAdmin(user)) {
    return res.status(404).json({ message: "Not Found" });
  }

  if (!ALLOWED_RESOURCES.has(req.body.resource)) {
    return res.status(400).json({ message: "Unknown resource" });
  }

  if (req.body.resource === "organizations") {
    req.body.resource = "organization";
  }

  if (req.body.resource === "organizationFeatures") {
    req.body.resource = "organizationFeature";
  }

  if (req.body.resource === "subscriptions") {
    req.body.resource = "subscription";
  }

  if (req.body.resource === "teams") {
    req.body.resource = "team";
  }

  if (req.body.resource === "user" && req.body.method === "getList") {
    const query = req.body.params?.filter?.query;
    if (req.body.params?.filter?.query) delete req.body.params.filter.query;

    const result = await getListHandler<Prisma.UserFindManyArgs>(
      req.body as GetListRequest,
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
                          name: { contains: query, mode: "insensitive" },
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
                              name: { contains: query, mode: "insensitive" },
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
          orgMemberships: {
            include: {
              organization: true,
            },
          },
          teamMemberships: {
            include: {
              team: {
                include: {
                  projects: true,
                },
              },
            },
          },
        },
        map: (
          users: (User & {
              orgMemberships: { organization: Organization }[];
              teamMemberships: { team: Team & { projects: Project[] } }[];
            })[]
        ) => {
          return users.map((user) => ({
            ...user,
            organizations: user.orgMemberships
              ?.map((orgMembership) => orgMembership.organization.name)
              .join(", "),
            teams: user.teamMemberships
              ?.map((teamMembership) => teamMembership.team.name)
              .join(", "),
            projects: user.teamMemberships
              ?.flatMap((teamMembership) =>
                teamMembership.team.projects?.map((project) => project.name)
              )
              .join(", "),
          }));
        },
      }
    );
    res.json(result);
    return;
  }

  if (req.body.resource === "organization" && req.body.method === "getList") {
    const query = req.body.params?.filter?.query;
    if (req.body.params?.filter?.query) delete req.body.params.filter.query;

    const result = await getListHandler<Prisma.OrganizationFindManyArgs>(
      req.body as GetListRequest,
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
      }
    );
    res.json(result);
    return;
  }

  if (req.body.resource === "project" && req.body.method === "getList") {
    const query = req.body.params?.filter?.query;
    if (req.body.params?.filter?.query) delete req.body.params.filter.query;

    const result = await getListHandler<Prisma.ProjectFindManyArgs>(
      req.body as GetListRequest,
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
      }
    );
    res.json(result);
    return;
  }

  // Admin "User" updates go through ra-data-simple-prisma's default
  // handler, which does raw prisma.user.update. For fields that require
  // side effects — `deactivatedAt` (force-logout) and `email` (cache
  // invalidation + lowercase normalization) — we must route through
  // UserService instead of letting the default handler do a bare update.
  // This is the same class of bug as iter 24 (session revocation bypass)
  // and iter 27 (email case normalization), now fixed for the admin panel
  // entry point which was missed in the earlier refactors. Grep iter-38.
  if (
    req.body.resource === "user" &&
    req.body.method === "update" &&
    req.body.params?.id &&
    req.body.params?.data
  ) {
    const userId = String(req.body.params.id);
    const data = req.body.params.data as Record<string, unknown>;
    const userService = UserService.create(prisma);
    let handledSideEffect = false;
    // Track audit metadata for the side-effect writes so the admin
    // activity log still captures the change. defaultHandler writes
    // its own audit entry for the fields it handles, but side effects
    // we run ourselves (deactivate, reactivate, email change) would be
    // invisible in the audit log without this explicit capture.
    const sideEffectAudit: Array<{ action: string; payload: object }> = [];

    // Case 1: admin is (de)activating the user. The DateInput in the form
    // emits an ISO string on set and null on clear.
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
        // UserService.deactivate sets deactivatedAt = new Date() and
        // revokes all sessions (iter 24+25). The admin's typed-in date
        // value is preserved post-hoc via a second update below.
        await userService.deactivate({ id: userId });
        delete data.deactivatedAt;
        handledSideEffect = true;
        // If the admin picked a specific historical date rather than
        // "now", apply it as a follow-up update. This is cosmetic —
        // the revocation already happened with the real current date.
        const pickedDate = v instanceof Date ? v : new Date(v);
        if (!Number.isNaN(pickedDate.getTime())) {
          await prisma.user.update({
            where: { id: userId },
            data: { deactivatedAt: pickedDate },
          });
        }
        sideEffectAudit.push({
          action: "update/user",
          payload: { id: userId, deactivate: true, pickedDate: pickedDate.toISOString() },
        });
      }
    }

    // Case 2: admin is changing the email. Normalize + revoke sessions
    // via UserService.updateProfile (iter 27) instead of a bare update.
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

    // Emit audit log entries for each side-effect write. Uses the same
    // `auditLog` helper that `defaultHandler`'s `audit.model.create`
    // callback uses, so these entries land in the same admin/update/user
    // action bucket as non-side-effect updates.
    for (const entry of sideEffectAudit) {
      await auditLog({
        userId: user.id,
        action: `admin/${entry.action}`,
        args: entry.payload,
        req,
      });
    }

    // If the admin ALSO changed other fields (name, pendingSsoSetup),
    // let defaultHandler run with the remaining data. If we've handled
    // EVERYTHING via the service, there's nothing left to send — respond
    // with the updated user directly to avoid an empty update that would
    // fail the react-admin contract.
    if (handledSideEffect && Object.keys(data).length === 0) {
      const updated = await prisma.user.findUnique({ where: { id: userId } });
      res.json({ data: updated });
      return;
    }
  }

  // Normalize ssoDomain to lowercase on organization create/update.
  // The runtime lookup uses `extractEmailDomain(email)` which lowercases
  // the email domain, and queries `where: {ssoDomain: domain}`. Without
  // normalizing at the admin write site, a mixed-case "ACME.COM" stored
  // by an admin would never match the lowercase domain extracted from
  // user emails, and SSO org auto-add would silently not fire. This is
  // a latent NextAuth-era bug that predates the migration but is worth
  // fixing now since SSO domain enforcement is a customer-facing feature.
  if (
    req.body.resource === "organization" &&
    (req.body.method === "create" || req.body.method === "update")
  ) {
    const params = req.body.params as
      | { data?: { ssoDomain?: string | null } }
      | undefined;
    const ssoDomain = params?.data?.ssoDomain;
    if (typeof ssoDomain === "string" && ssoDomain.trim() !== "") {
      params!.data!.ssoDomain = ssoDomain.trim().toLowerCase();
    }
  }

  if (req.body.resource === "subscription" && req.body.method === "getList") {
    const query = req.body.params?.filter?.query;
    if (req.body.params?.filter?.query) delete req.body.params.filter.query;

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
        stripeSubscriptionId: { contains: query, mode: "insensitive" },
      });
      orFilters.push({
        organization: {
          name: { contains: query, mode: "insensitive" },
        },
      });
      if (matchingPlan) {
        orFilters.push({ plan: { equals: matchingPlan } });
      }
      if (matchingStatus) {
        orFilters.push({ status: { equals: matchingStatus } });
      }
    }

    const result = await getListHandler<Prisma.SubscriptionFindManyArgs>(
      req.body as GetListRequest,
      prisma.subscription,
      {
        where: orFilters.length > 0 ? { OR: orFilters } : {},
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      }
    );
    res.json(result);
    return;
  }

  const result = await defaultHandler(req.body, prisma as any, {
    audit: {
      model: {
        create: async ({
          data,
        }: {
          data: {
            action: string;
            resource: string;
            payload: object;
            author: {
              connect: {
                id: string;
              };
            };
          };
        }) => {
          await auditLog({
            userId: data.author.connect.id,
            action: `admin/${data.action}/${data.resource}`,
            args: data.payload,
            req,
          });
        },
      },
      authProvider: {
        getIdentity: async () => {
          return {
            id: user?.id ?? session?.user.id,
            fullName: user?.name ?? session?.user.name,
          };
        },
      } as any,
    },
  });

  res.json(result);
}
