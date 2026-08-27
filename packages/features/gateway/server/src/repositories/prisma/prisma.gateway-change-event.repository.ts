/**
 * GatewayChangeEvent is the monotonic revision feed the Go gateway long-polls
 * via `GET /api/internal/gateway/changes?since=<revision>`. Any mutation that
 * affects a gateway-visible artifact (VK, budget, ModelProvider) must
 * append an event here.
 */
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { z } from "zod";
import {
  GatewayChangeEventsPort,
  type AppendGatewayChangeEventInput,
  type GatewayChangeEventKind,
  type GatewayPersistenceTransaction,
} from "../../ports/gateway-change-events.port";

export class PrismaGatewayChangeEventsRepository extends GatewayChangeEventsPort {
  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async append(
    input: AppendGatewayChangeEventInput,
    transaction?: GatewayPersistenceTransaction,
  ): Promise<{ revision: bigint }> {
    const client = transaction ? (transaction as Prisma.TransactionClient) : this.prisma;
    const event = await client.gatewayChangeEvent.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        kind: input.kind,
        virtualKeyId: input.virtualKeyId ?? null,
        budgetId: input.budgetId ?? null,
        modelProviderId: input.modelProviderId ?? null,
        payload: jsonInput(input.payload),
      },
      select: { revision: true },
    });
    return { revision: event.revision };
  }

  /**
   * Fetch events strictly greater than `since`. The gateway keeps its own
   * revision pointer and calls this repeatedly via the long-poll endpoint.
   */
  async since(
    organizationId: string,
    since: bigint,
    limit = 500,
  ): Promise<{
    currentRevision: bigint;
    events: Array<{
      revision: bigint;
      kind: GatewayChangeEventKind;
      virtualKeyId: string | null;
      budgetId: string | null;
      modelProviderId: string | null;
      projectId: string | null;
    }>;
  }> {
    const events = await this.prisma.gatewayChangeEvent.findMany({
      where: { organizationId, revision: { gt: since } },
      orderBy: { revision: "asc" },
      take: limit,
      select: {
        revision: true,
        kind: true,
        virtualKeyId: true,
        budgetId: true,
        modelProviderId: true,
        projectId: true,
      },
    });
    const last = events.at(-1);
    const currentRevision = last?.revision ?? since;
    return { currentRevision, events };
  }

  async currentRevision(organizationId: string): Promise<bigint> {
    const last = await this.prisma.gatewayChangeEvent.findFirst({
      where: { organizationId },
      orderBy: { revision: "desc" },
      select: { revision: true },
    });
    return last?.revision ?? 0n;
  }
}

export function createGatewayChangeEventsPort(
  database: PrismaClient,
): GatewayChangeEventsPort {
  return new PrismaGatewayChangeEventsRepository(database);
}

function jsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return z.json().parse(value) as Prisma.InputJsonValue;
}
