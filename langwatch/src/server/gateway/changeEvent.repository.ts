/**
 * GatewayChangeEvent is the monotonic revision feed the Go gateway long-polls
 * via `GET /api/internal/gateway/changes?since=<revision>`. Any mutation that
 * affects a gateway-visible artifact (VK, budget, provider binding) must
 * append an event here.
 */
import type {
  GatewayChangeEventKind,
  Prisma,
  PrismaClient,
} from "@prisma/client";

export type AppendChangeEventInput = {
  organizationId: string;
  projectId?: string | null;
  kind: GatewayChangeEventKind;
  virtualKeyId?: string | null;
  budgetId?: string | null;
  providerCredentialId?: string | null;
  payload?: Prisma.InputJsonValue | null;
};

export class ChangeEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async append(
    input: AppendChangeEventInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ revision: bigint }> {
    const client = tx ?? this.prisma;
    const event = await client.gatewayChangeEvent.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        kind: input.kind,
        virtualKeyId: input.virtualKeyId ?? null,
        budgetId: input.budgetId ?? null,
        providerCredentialId: input.providerCredentialId ?? null,
        payload: input.payload ?? null,
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
      providerCredentialId: string | null;
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
        providerCredentialId: true,
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
