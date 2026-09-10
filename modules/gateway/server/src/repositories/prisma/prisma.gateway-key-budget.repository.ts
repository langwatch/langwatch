import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import type { GatewayBudget } from "@langwatch/gateway-contract";
import { toGatewayBudgetRow } from "./prisma.gateway-budget.repository.ts";
import type { GatewayPersistenceTransaction } from "../../app/gateway.infrastructure.ts";
import {
  GatewayKeyBudgetRepository,
  type GatewayKeyBudgetFields,
  type GatewayKeyBudgetScope,
} from "../gateway-key-budget.repository.ts";
import { toDate, type Instant } from "@langwatch/time";

/** The client slice a key's own caps are written through. */
export type GatewayKeyBudgetDatabase = Pick<PrismaClient, "gatewayBudget">;

/** Private Prisma owner for the caps a virtual key's drawer manages. */
export class PrismaGatewayKeyBudgetRepository extends GatewayKeyBudgetRepository {
  static create(input: { database: GatewayKeyBudgetDatabase }): PrismaGatewayKeyBudgetRepository {
    return new PrismaGatewayKeyBudgetRepository(input.database);
  }

  private constructor(private readonly database: GatewayKeyBudgetDatabase) {
    super();
  }

  async tryFindDrawerManaged(
    { organizationId, virtualKeyId }: { organizationId: string; virtualKeyId: string },
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayBudget | null> {
    const row = await this.client(transaction).gatewayBudget.findFirst({
      where: { organizationId, managedByVirtualKeyId: virtualKeyId, archivedAt: null },
    });

    return row ? toGatewayBudgetRow(row) : null;
  }

  async createForKey(
    input: {
      organizationId: string;
      virtualKeyId: string;
      createdById: string;
      resetsAt: Instant;
      fields: GatewayKeyBudgetFields;
    },
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayBudget> {
    return toGatewayBudgetRow(
      await this.client(transaction).gatewayBudget.create({
        data: {
          ...input.fields,
          organizationId: input.organizationId,
          scopeType: "VIRTUAL_KEY",
          scopeId: input.virtualKeyId,
          managedByVirtualKeyId: input.virtualKeyId,
          createdById: input.createdById,
          resetsAt: toDate(input.resetsAt),
        },
      }),
    );
  }

  async updateForKey(
    input: { id: string; resetsAt?: Instant; fields: GatewayKeyBudgetFields },
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayBudget> {
    return toGatewayBudgetRow(
      await this.client(transaction).gatewayBudget.update({
        where: { id: input.id },
        data: {
          ...input.fields,
          ...(input.resetsAt ? { resetsAt: toDate(input.resetsAt) } : {}),
        },
      }),
    );
  }

  async findActiveForKey(
    {
      organizationId,
      virtualKeyId,
      scope,
    }: { organizationId: string; virtualKeyId: string; scope: GatewayKeyBudgetScope },
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayBudget[]> {
    const rows = await this.client(transaction).gatewayBudget.findMany({
      where: {
        organizationId,
        archivedAt: null,
        ...(scope === "drawerManaged"
          ? { managedByVirtualKeyId: virtualKeyId }
          : {
              OR: [
                { managedByVirtualKeyId: virtualKeyId },
                // Scoped to this key and nothing else. ATTRIBUTED_USER counts
                // only when the key is its anchor; PROJECT/TEAM/ORGANIZATION
                // budgets outlive any one key and stay untouched.
                { scopeType: { in: ["VIRTUAL_KEY", "ATTRIBUTED_USER"] }, scopeId: virtualKeyId },
              ],
            }),
      },
    });

    return rows.map(toGatewayBudgetRow);
  }

  async archive(
    { id, archivedAt }: { id: string; archivedAt: Instant },
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayBudget> {
    return toGatewayBudgetRow(
      await this.client(transaction).gatewayBudget.update({
        where: { id },
        data: { archivedAt: toDate(archivedAt) },
      }),
    );
  }

  private client(
    transaction?: GatewayPersistenceTransaction,
  ): GatewayKeyBudgetDatabase | Prisma.TransactionClient {
    return transaction ? (transaction as Prisma.TransactionClient) : this.database;
  }
}
