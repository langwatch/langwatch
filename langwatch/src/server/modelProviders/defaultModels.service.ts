/**
 * Hierarchical default-model resolution and writes.
 *
 * The project, the team it belongs to, and the organization can each carry
 * their own `defaultModel`, `topicClusteringModel`, and `embeddingsModel`.
 * Resolution walks project → team → organization → built-in constant (see
 * `getEffectiveDefaults` in `utils/modelProviderHelpers.ts`). Writes are
 * routed to the scope the caller specifies and authz is enforced upstream
 * in the tRPC layer.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import {
  getEffectiveDefaultsWithSource,
  type EffectiveDefaultsWithSource,
  type ScopeDefaults,
} from "~/utils/modelProviderHelpers";

export type DefaultModelScope = "ORGANIZATION" | "TEAM" | "PROJECT";

export type DefaultModelsInput = {
  defaultModel?: string | null;
  topicClusteringModel?: string | null;
  embeddingsModel?: string | null;
};

export type ResolvedDefaultModels = {
  effective: EffectiveDefaultsWithSource;
  organization: DefaultModelsInput | null;
  team: DefaultModelsInput | null;
  project: DefaultModelsInput | null;
};

export class DefaultModelsService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): DefaultModelsService {
    return new DefaultModelsService(prisma);
  }

  /**
   * Persist default-model fields at the given scope. A null value clears the
   * field; an undefined value leaves it unchanged. Returns the updated raw
   * scope row so callers can refresh local state.
   */
  async setForScope({
    scopeType,
    scopeId,
    values,
  }: {
    scopeType: DefaultModelScope;
    scopeId: string;
    values: DefaultModelsInput;
  }): Promise<DefaultModelsInput> {
    // Only forward fields the caller explicitly provided so undefined keeps
    // the existing value untouched. Null is forwarded — Prisma writes it.
    const data: Record<string, string | null> = {};
    for (const key of [
      "defaultModel",
      "topicClusteringModel",
      "embeddingsModel",
    ] as const) {
      if (key in values) {
        data[key] = values[key] ?? null;
      }
    }

    if (Object.keys(data).length === 0) {
      // No-op: nothing to update. Read back the current row instead.
      const current = await this.readScope(scopeType, scopeId);
      return current ?? {};
    }

    try {
      if (scopeType === "ORGANIZATION") {
        const row = await this.prisma.organization.update({
          where: { id: scopeId },
          data,
          select: {
            defaultModel: true,
            topicClusteringModel: true,
            embeddingsModel: true,
          },
        });
        return row;
      }
      if (scopeType === "TEAM") {
        const row = await this.prisma.team.update({
          where: { id: scopeId },
          data,
          select: {
            defaultModel: true,
            topicClusteringModel: true,
            embeddingsModel: true,
          },
        });
        return row;
      }
      const row = await this.prisma.project.update({
        where: { id: scopeId },
        data,
        select: {
          defaultModel: true,
          topicClusteringModel: true,
          embeddingsModel: true,
        },
      });
      return row;
    } catch (err) {
      // Surface a friendly NOT_FOUND when the caller targets a scope id
      // that no longer exists, instead of leaking Prisma's internal P2025
      // error to the tRPC client.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2025"
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `${scopeType.toLowerCase()} not found`,
        });
      }
      throw err;
    }
  }

  /**
   * Returns the effective default models for a project, the per-scope raw
   * values, and which scope each effective field came from.
   */
  async getForProject(projectId: string): Promise<ResolvedDefaultModels> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        defaultModel: true,
        topicClusteringModel: true,
        embeddingsModel: true,
        team: {
          select: {
            id: true,
            defaultModel: true,
            topicClusteringModel: true,
            embeddingsModel: true,
            organization: {
              select: {
                id: true,
                defaultModel: true,
                topicClusteringModel: true,
                embeddingsModel: true,
              },
            },
          },
        },
      },
    });
    if (!project) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Project not found",
      });
    }
    const team = project.team;
    const organization = team?.organization ?? null;

    const projectScope: ScopeDefaults = {
      defaultModel: project.defaultModel,
      topicClusteringModel: project.topicClusteringModel,
      embeddingsModel: project.embeddingsModel,
    };
    const teamScope: ScopeDefaults = team
      ? {
          defaultModel: team.defaultModel,
          topicClusteringModel: team.topicClusteringModel,
          embeddingsModel: team.embeddingsModel,
        }
      : null;
    const orgScope: ScopeDefaults = organization
      ? {
          defaultModel: organization.defaultModel,
          topicClusteringModel: organization.topicClusteringModel,
          embeddingsModel: organization.embeddingsModel,
        }
      : null;

    return {
      effective: getEffectiveDefaultsWithSource(
        projectScope,
        teamScope,
        orgScope,
      ),
      organization: orgScope as DefaultModelsInput | null,
      team: teamScope as DefaultModelsInput | null,
      project: projectScope as DefaultModelsInput,
    };
  }

  private async readScope(
    scopeType: DefaultModelScope,
    scopeId: string,
  ): Promise<DefaultModelsInput | null> {
    const select = {
      defaultModel: true,
      topicClusteringModel: true,
      embeddingsModel: true,
    } as const;
    if (scopeType === "ORGANIZATION") {
      return this.prisma.organization.findUnique({
        where: { id: scopeId },
        select,
      });
    }
    if (scopeType === "TEAM") {
      return this.prisma.team.findUnique({ where: { id: scopeId }, select });
    }
    return this.prisma.project.findUnique({ where: { id: scopeId }, select });
  }
}
