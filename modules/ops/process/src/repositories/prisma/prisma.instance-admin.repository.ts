import {
  AdminSubscriptionAlreadyActiveError,
  adminUserSortFieldSchema,
  type AdminDataResult,
  type AdminListResult,
  type AdminOperationInput,
  type AdminOperationParams,
  type AdminOperationResult,
  type AdminUserSortField,
  type UserWithAdminIncludes,
} from "@langwatch/ops-contract";
import { skipTenantCheck } from "@langwatch/prisma-client";
import { PlanTypes, Prisma, SubscriptionStatus } from "@langwatch/prisma-client/generated";
import { defaultHandler, getListHandler, getOneHandler } from "ra-data-simple-prisma";

import { toAdminUserRow } from "../../rules/admin-user-row.rules.ts";
import { isSecondLivePlanViolation } from "../../rules/subscription-live-plan.rules.ts";
import { InstanceAdminRepository } from "../instance-admin.repository.ts";
import {
  type AdminDatabase,
  ORGANIZATION_SAFE_SELECT,
  PROJECT_SAFE_SELECT,
} from "./prisma.admin.repository.ts";

const USER_ADMIN_INCLUDE = {
  orgMemberships: {
    include: {
      organization: {
        include: {
          teams: {
            where: { archivedAt: null },
            include: { projects: { where: { archivedAt: null } } },
          },
        },
      },
    },
  },
} as const;

/**
 * Each users-list column as the SQL it orders by; Status ranks Active, Unverified, Pending SSO,
 * Deactivated.
 */
const USER_ORDER_BY: Record<AdminUserSortField, Prisma.Sql> = {
  id: Prisma.sql`u."id"`,
  name: Prisma.sql`NULLIF(lower(u."name"), '')`,
  email: Prisma.sql`NULLIF(lower(u."email"), '')`,
  createdAt: Prisma.sql`u."createdAt"`,
  lastLoginAt: Prisma.sql`u."lastLoginAt"`,
  organizations: Prisma.sql`(SELECT count(*) FROM "OrganizationUser" ou WHERE ou."userId" = u."id")`,
  projects: Prisma.sql`(
    SELECT count(DISTINCT p."id") FROM "OrganizationUser" ou
    JOIN "Team" t ON t."organizationId" = ou."organizationId" AND t."archivedAt" IS NULL
    JOIN "Project" p ON p."teamId" = t."id" AND p."archivedAt" IS NULL
    WHERE ou."userId" = u."id")`,
  status: Prisma.sql`CASE
    WHEN u."deactivatedAt" IS NOT NULL THEN 3
    WHEN u."pendingSsoSetup" THEN 2
    WHEN u."emailVerified" THEN 0
    ELSE 1 END`,
};

// The Back office lists every account on the installation, so the user list has no tenant to pin.
const USER_LIST_TENANCY = skipTenantCheck({ SKIP_TENANT_CHECK: true });

/** The text a search term matches anywhere inside, with LIKE's wildcards taken literally. */
function containsPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * Private Prisma/React-Admin adapter for the Ops instance admin surface.
 */
export class PrismaInstanceAdminRepository extends InstanceAdminRepository {
  private constructor(private readonly database: AdminDatabase) {
    super();
  }

  static create(database: AdminDatabase): PrismaInstanceAdminRepository {
    return new PrismaInstanceAdminRepository(database);
  }

  async execute(input: AdminOperationInput): Promise<AdminOperationResult> {
    switch (input.method) {
      case "getList":
        return this.getList(input.resource, input.params);
      case "getOne":
        return this.getOne(input.resource, input.params);
      case "getMany":
      case "getManyReference":
      case "create":
      case "update":
      case "updateMany":
      case "delete":
      case "deleteMany":
        return this.executeDefault(input);
    }
  }

  async findActiveSubscriptionIds({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string[]> {
    const rows = await this.database.subscription.findMany({
      where: { organizationId, status: SubscriptionStatus.ACTIVE },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  findSubscriptionStates({
    ids,
  }: {
    ids: string[];
  }): Promise<{ id: string; organizationId: string; status: string }[]> {
    return this.database.subscription.findMany({
      where: { id: { in: ids } },
      select: { id: true, organizationId: true, status: true },
    });
  }

  async findUserById(id: string): Promise<AdminDataResult> {
    const data = await this.database.user.findUnique({ where: { id } });
    return { data };
  }

  private async getList(
    resource: AdminOperationInput["resource"],
    params: AdminOperationParams,
  ): Promise<AdminListResult> {
    const query = this.query(resource, params);
    const requestParams = this.listParams(params, query.filter);

    switch (resource) {
      case "user":
        return this.listUsers(params);
      case "organization":
        return getListHandler(
          { method: "getList", resource, params: requestParams },
          this.database.organization,
          { ...query.where, select: ORGANIZATION_SAFE_SELECT },
        );
      case "project":
        return getListHandler(
          { method: "getList", resource, params: requestParams },
          this.database.project,
          { ...query.where, select: PROJECT_SAFE_SELECT },
        );
      case "subscription":
        return getListHandler(
          { method: "getList", resource, params: requestParams },
          this.database.subscription,
          {
            ...query.where,
            include: {
              organization: {
                select: { id: true, name: true, slug: true },
              },
            },
          },
        );
      case "team":
        return getListHandler(
          { method: "getList", resource, params: requestParams },
          this.database.team,
        );
    }
  }

  /** Users order in SQL across the whole search, then the page's rows load with memberships. */
  private async listUsers(params: AdminOperationParams): Promise<AdminListResult> {
    const filter = params.filter ?? {};
    const query = typeof filter.query === "string" && filter.query ? filter.query : undefined;
    const ids = Array.isArray(filter.id) ? filter.id.map(String) : undefined;
    const field = adminUserSortFieldSchema.catch("id").parse(params.sort?.field ?? "id");
    const direction = params.sort?.order === "DESC" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const perPage = params.pagination?.perPage ?? 25;
    const offset = ((params.pagination?.page ?? 1) - 1) * perPage;

    const conditions: Prisma.Sql[] = [];
    if (ids) conditions.push(Prisma.sql`u."id" = ANY(${ids}::text[])`);
    if (query) {
      const pattern = containsPattern(query);
      conditions.push(Prisma.sql`(
        u."id" ILIKE ${pattern} OR u."name" ILIKE ${pattern} OR u."email" ILIKE ${pattern}
        OR EXISTS (SELECT 1 FROM "OrganizationUser" ou
          JOIN "Organization" o ON o."id" = ou."organizationId"
          WHERE ou."userId" = u."id" AND (o."id" ILIKE ${pattern} OR o."name" ILIKE ${pattern}))
        OR EXISTS (SELECT 1 FROM "OrganizationUser" ou
          JOIN "Team" t ON t."organizationId" = ou."organizationId"
          JOIN "Project" p ON p."teamId" = t."id"
          WHERE ou."userId" = u."id" AND (p."id" ILIKE ${pattern} OR p."name" ILIKE ${pattern})))`);
    }
    const where =
      conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;

    const [page, counted] = await Promise.all([
      this.database.$queryRaw<{ id: string }[]>(Prisma.sql`${USER_LIST_TENANCY}
        SELECT u."id" FROM "User" u ${where}
        ORDER BY ${USER_ORDER_BY[field]} ${direction} NULLS LAST, u."id" ${direction}
        LIMIT ${perPage} OFFSET ${offset}`),
      this.database.$queryRaw<{ total: number }[]>(Prisma.sql`${USER_LIST_TENANCY}
        SELECT count(*)::int AS total FROM "User" u ${where}`),
    ]);
    const pageIds = page.map((row) => row.id);
    const users: UserWithAdminIncludes[] = await this.database.user.findMany({
      where: { id: { in: pageIds } },
      include: USER_ADMIN_INCLUDE,
    });
    const byId = new Map(users.map((user) => [user.id, user]));
    return {
      data: pageIds.flatMap((id) => {
        const user = byId.get(id);
        return user ? [toAdminUserRow(user)] : [];
      }),
      total: counted[0]?.total ?? 0,
    };
  }

  private async getOne(
    resource: AdminOperationInput["resource"],
    params: AdminOperationParams,
  ): Promise<AdminDataResult> {
    const id = String(params.id ?? "");
    const request = { method: "getOne" as const, resource, params: { id } };

    switch (resource) {
      case "organization":
        return getOneHandler(request, this.database.organization, {
          select: ORGANIZATION_SAFE_SELECT,
        });
      case "project":
        return getOneHandler(request, this.database.project, {
          select: PROJECT_SAFE_SELECT,
        });
      case "user":
        return getOneHandler(request, this.database.user);
      case "subscription":
        return getOneHandler(request, this.database.subscription);
      case "team":
        return getOneHandler(request, this.database.team);
    }
  }

  private async executeDefault(input: AdminOperationInput): Promise<AdminDataResult> {
    const params = this.defaultParams(input.method, input.params);
    try {
      return await defaultHandler(
        { method: input.method, resource: input.resource, params },
        this.database,
      );
    } catch (error) {
      if (input.resource !== "subscription" || !isSecondLivePlanViolation(error)) throw error;
      throw await this.secondLivePlanRefusal(input);
    }
  }

  /** The refusal naming the live plan a write raced; the organization comes from the write. */
  private async secondLivePlanRefusal(
    input: AdminOperationInput,
  ): Promise<AdminSubscriptionAlreadyActiveError> {
    const given = input.params.data?.organizationId;
    const ids = [input.params.id, ...this.stringArray(input.params.ids)]
      .filter((id) => id !== undefined && id !== null && id !== "")
      .map(String);
    const stored = typeof given === "string" ? [] : await this.findSubscriptionStates({ ids });
    const organizationId = typeof given === "string" ? given : (stored[0]?.organizationId ?? "");
    const activeSubscriptionIds = (await this.findActiveSubscriptionIds({ organizationId })).filter(
      (id) => !ids.includes(id),
    );
    return new AdminSubscriptionAlreadyActiveError({ organizationId, activeSubscriptionIds });
  }

  private defaultParams(method: AdminOperationInput["method"], params: AdminOperationParams) {
    switch (method) {
      case "getMany":
        return { ids: this.stringArray(params.ids) };
      case "getManyReference":
        return {
          target: this.stringValue(params.target),
          id: this.stringValue(params.id),
          ...this.listParams(params, params.filter ?? {}),
        };
      case "create":
        return { data: params.data ?? {} };
      case "update":
        return {
          id: this.stringValue(params.id),
          data: params.data ?? {},
          ...(params.previousData ? { previousData: params.previousData } : {}),
        };
      case "updateMany":
        return { ids: this.stringArray(params.ids), data: params.data ?? {} };
      case "delete":
        return {
          id: this.stringValue(params.id),
          ...(params.previousData ? { previousData: params.previousData } : {}),
        };
      case "deleteMany":
        return { ids: this.stringArray(params.ids) };
      case "getList":
      case "getOne":
        return {};
    }
  }

  private listParams(params: AdminOperationParams, filter: Record<string, unknown>) {
    return {
      pagination: {
        page: params.pagination?.page ?? 1,
        perPage: params.pagination?.perPage ?? 25,
      },
      sort: {
        field: params.sort?.field ?? "id",
        order: params.sort?.order ?? "ASC",
      },
      filter,
    };
  }

  /** An `id` list narrows to those rows; the list handler would hand the array to Prisma as is. */
  private query(
    resource: AdminOperationInput["resource"],
    params: AdminOperationParams,
  ): {
    filter: Record<string, unknown>;
    where: Record<string, unknown>;
  } {
    const filter = { ...params.filter };
    const ids = Array.isArray(filter.id) ? filter.id.map(String) : undefined;
    if (ids) delete filter.id;
    const searched = this.searchQuery(resource, filter);
    if (!ids) return searched;
    const search = (searched.where as { where?: Record<string, unknown> }).where ?? {};
    return {
      filter: searched.filter,
      where: { ...searched.where, where: { ...search, id: { in: ids } } },
    };
  }

  private searchQuery(
    resource: AdminOperationInput["resource"],
    filter: Record<string, unknown>,
  ): {
    filter: Record<string, unknown>;
    where: Record<string, unknown>;
  } {
    const query = typeof filter.query === "string" ? filter.query : undefined;
    delete filter.query;
    if (!query) return { filter, where: {} };

    const insensitive = { contains: query, mode: "insensitive" as const };
    switch (resource) {
      case "subscription": {
        const upperQuery = query.toUpperCase();
        const matchingPlan = Object.values(PlanTypes).find((plan) => plan === upperQuery);
        const matchingStatus = Object.values(SubscriptionStatus).find(
          (status) => status === upperQuery,
        );
        return {
          filter,
          where: {
            where: {
              OR: [
                { id: insensitive },
                { stripeSubscriptionId: insensitive },
                {
                  organization: {
                    OR: [{ id: insensitive }, { name: insensitive }, { slug: insensitive }],
                  },
                },
                ...(matchingPlan ? [{ plan: { equals: matchingPlan } }] : []),
                ...(matchingStatus ? [{ status: { equals: matchingStatus } }] : []),
              ],
            },
          },
        };
      }
      case "organization":
      case "project":
        return {
          filter,
          where: {
            where: {
              OR: [{ id: insensitive }, { name: insensitive }, { slug: insensitive }],
            },
          },
        };
      case "user":
      case "team":
        return { filter, where: {} };
    }
    /* istanbul ignore next -- the resource schema makes this unreachable. */
    return {
      filter,
      where: {},
    };
  }

  private stringValue(value: unknown): string {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
      return String(value);
    }
    return value == null ? "" : JSON.stringify(value);
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map((item) => String(item)) : [];
  }
}
