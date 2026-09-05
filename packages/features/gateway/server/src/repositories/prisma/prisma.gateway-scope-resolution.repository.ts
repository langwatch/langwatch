import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import type { GatewayPersistenceTransaction } from "../../ports/gateway-change-events.port";
import {
  GatewayScopeResolutionRepository,
  type EligibleModelProvider,
  type GatewayRoutingPolicyOrder,
} from "../gateway-scope-resolution.repository";

/** The client slice the scope graph is read through. */
export type GatewayScopeResolutionDatabase = Pick<
  PrismaClient,
  "modelProvider" | "project" | "routingPolicy"
>;

type ScopePredicate =
  | { scopeType: "ORGANIZATION"; scopeId: string }
  | { scopeType: "TEAM"; scopeId: string | { in: string[] } }
  | { scopeType: "PROJECT"; scopeId: string | { in: string[] } };

/** Private Prisma owner for the scope graph a virtual key reaches providers through. */
export class PrismaGatewayScopeResolutionRepository extends GatewayScopeResolutionRepository {
  static create(input: {
    database: GatewayScopeResolutionDatabase;
  }): PrismaGatewayScopeResolutionRepository {
    return new PrismaGatewayScopeResolutionRepository(input.database);
  }

  private constructor(private readonly database: GatewayScopeResolutionDatabase) {
    super();
  }

  async findTeamIdsForProjects({
    projectIds,
    transaction,
  }: {
    projectIds: string[];
    transaction?: GatewayPersistenceTransaction;
  }): Promise<string[]> {
    const projects = await this.client(transaction).project.findMany({
      where: { id: { in: projectIds } },
      select: { teamId: true },
    });

    return projects.map((project) => project.teamId);
  }

  async findProvidersReachableFromScopes({
    organizationIds,
    teamIds,
    projectIds,
    transaction,
  }: {
    organizationIds: string[];
    teamIds: string[];
    projectIds: string[];
    transaction?: GatewayPersistenceTransaction;
  }): Promise<EligibleModelProvider[]> {
    const predicates: ScopePredicate[] = organizationIds.map((scopeId) => ({
      scopeType: "ORGANIZATION",
      scopeId,
    }));
    if (teamIds.length > 0) {
      predicates.push({ scopeType: "TEAM", scopeId: { in: teamIds } });
    }

    if (projectIds.length > 0) {
      predicates.push({ scopeType: "PROJECT", scopeId: { in: projectIds } });
    }

    if (predicates.length === 0) {
      return [];
    }

    return await this.client(transaction).modelProvider.findMany({
      where: {
        enabled: true,
        disabledAt: null,
        scopes: { some: { OR: predicates } },
      },
    });
  }

  async findRoutingPolicyOrder({
    routingPolicyId,
    transaction,
  }: {
    routingPolicyId: string;
    transaction?: GatewayPersistenceTransaction;
  }): Promise<GatewayRoutingPolicyOrder | null> {
    return await this.client(transaction).routingPolicy.findUnique({
      where: { id: routingPolicyId },
      select: { modelProviderIds: true, organizationId: true },
    });
  }

  /** The transaction-scoped client when the caller is inside one, else the root. */
  private client(
    transaction?: GatewayPersistenceTransaction,
  ): GatewayScopeResolutionDatabase | Prisma.TransactionClient {
    return transaction ? (transaction as Prisma.TransactionClient) : this.database;
  }
}
