import {
  defaultHandler,
  getListHandler,
  getOneHandler,
} from "ra-data-simple-prisma";
import {
  PlanTypes,
  type PrismaClient,
  SubscriptionStatus,
} from "@langwatch/prisma-client/generated";
import type {
  AdminDataResult,
  AdminListResult,
  AdminOperationInput,
  AdminOperationParams,
  AdminOperationResult,
} from "@langwatch/ops-contract";
import type { UserWithBackofficeIncludes } from "@langwatch/ops-contract";
import {
  type AdminDatabase,
  ORGANIZATION_SAFE_SELECT,
  PROJECT_SAFE_SELECT,
} from "./prisma.admin.repository";
import {
  PrismaAdminUserMapper,
  USER_BACKOFFICE_INCLUDE,
} from "./prisma.admin-user.mapper";
import { AdminBackofficeRepository } from "../admin-backoffice.repository";

/**
 * Private Prisma/React-Admin adapter for the Ops backoffice surface.
 *
 * The transport deliberately does not know that this is backed by Prisma or
 * ra-data-simple-prisma. Keeping the compatibility adapter here preserves the
 * existing response shape while the shared Ops contract stays portable.
 */
export class PrismaAdminBackofficeRepository extends AdminBackofficeRepository {
  private constructor(private readonly database: AdminDatabase) {
    super();
  }

  static create(database: AdminDatabase): PrismaAdminBackofficeRepository {
    return new PrismaAdminBackofficeRepository(database);
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

  async findUserById(id: string): Promise<AdminDataResult> {
    const data = await this.database.user.findUnique({ where: { id } });
    return { data };
  }

  async setUserDeactivatedAt(id: string, value: Date): Promise<void> {
    await this.database.user.update({
      where: { id },
      data: { deactivatedAt: value },
    });
  }

  private async getList(
    resource: AdminOperationInput["resource"],
    params: AdminOperationParams,
  ): Promise<AdminListResult> {
    const query = this.query(resource, params);
    const requestParams = this.listParams(params, query.filter);

    switch (resource) {
      case "user":
        return getListHandler(
          { method: "getList", resource, params: requestParams },
          this.database.user,
          {
            ...query.where,
            include: USER_BACKOFFICE_INCLUDE,
            map: (users: UserWithBackofficeIncludes[]) =>
              users.map(PrismaAdminUserMapper.map),
          },
        );
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

  private executeDefault(input: AdminOperationInput): Promise<AdminDataResult> {
    const params = this.defaultParams(input.method, input.params);
    return defaultHandler(
      { method: input.method, resource: input.resource, params },
      this.database,
    );
  }

  private defaultParams(
    method: AdminOperationInput["method"],
    params: AdminOperationParams,
  ) {
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
          ...(params.previousData
            ? { previousData: params.previousData }
            : {}),
        };
      case "updateMany":
        return { ids: this.stringArray(params.ids), data: params.data ?? {} };
      case "delete":
        return {
          id: this.stringValue(params.id),
          ...(params.previousData
            ? { previousData: params.previousData }
            : {}),
        };
      case "deleteMany":
        return { ids: this.stringArray(params.ids) };
      case "getList":
      case "getOne":
        return {};
    }
  }

  private listParams(
    params: AdminOperationParams,
    filter: Record<string, unknown>,
  ) {
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

  private query(
    resource: AdminOperationInput["resource"],
    params: AdminOperationParams,
  ): {
    filter: Record<string, unknown>;
    where: Record<string, unknown>;
  } {
    const filter = { ...(params.filter ?? {}) };
    const query = typeof filter.query === "string" ? filter.query : undefined;
    delete filter.query;
    if (!query) return { filter, where: {} };

    const insensitive = { contains: query, mode: "insensitive" as const };
    switch (resource) {
      case "user":
        return {
          filter,
          where: {
            where: {
              OR: [
                { id: insensitive },
                { name: insensitive },
                { email: insensitive },
                {
                  orgMemberships: {
                    some: {
                      organization: {
                        OR: [
                          { id: insensitive },
                          { name: insensitive },
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
                                  { id: insensitive },
                                  { name: insensitive },
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
          },
        };
      case "subscription": {
        const upperQuery = query.toUpperCase();
        const matchingPlan = Object.values(PlanTypes).find(
          (plan) => plan === upperQuery,
        );
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
                    OR: [
                      { id: insensitive },
                      { name: insensitive },
                      { slug: insensitive },
                    ],
                  },
                },
                ...(matchingPlan ? [{ plan: { equals: matchingPlan } }] : []),
                ...(matchingStatus
                  ? [{ status: { equals: matchingStatus } }]
                  : []),
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
              OR: [
                { id: insensitive },
                { name: insensitive },
                { slug: insensitive },
              ],
            },
          },
        };
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
    return String(value ?? "");
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map((item) => String(item)) : [];
  }
}
