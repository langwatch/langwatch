import {
  GatewayA2aTargetHeadersNeedReplacingError,
  GatewayA2aTargetNameTakenError,
  createGatewayA2aTargetInputSchema,
  gatewayA2aTargetHeadersSchema,
  gatewayA2aTargetResourceSchema,
  type CreateGatewayA2aTargetInput,
  type GatewayA2aTargetResource,
} from "@langwatch/gateway-contract";
import { generate } from "@langwatch/ksuid";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { z } from "zod";

import {
  GatewayA2aTargetRepository,
  type GatewayA2aTargetUpdate,
} from "../gateway-a2a-target.repository.ts";
import type { GatewayPersistenceTransaction } from "../gateway-transaction.repository.ts";
import type { GatewayCipher } from "../gateway.repositories.ts";

type A2aTargetRow = Awaited<ReturnType<PrismaClient["gatewayA2ATarget"]["findFirstOrThrow"]>>;

/** A2A targets in Postgres: the upstream headers rest sealed in `encryptedUpstreamHeaders`. */
export class PrismaGatewayA2aTargetRepository extends GatewayA2aTargetRepository {
  private constructor(
    private readonly prisma: PrismaClient,
    private readonly cipher: GatewayCipher,
  ) {
    super();
  }

  static create({
    prisma,
    cipher,
  }: Readonly<{ prisma: PrismaClient; cipher: GatewayCipher }>): PrismaGatewayA2aTargetRepository {
    return new PrismaGatewayA2aTargetRepository(prisma, cipher);
  }

  async findAll(
    organizationId: string,
    options?: { headers?: boolean },
  ): Promise<GatewayA2aTargetResource[]> {
    const rows = await this.prisma.gatewayA2ATarget.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => this.#toResource(row, options?.headers ?? true));
  }

  async findByProject(input: {
    organizationId: string;
    projectId: string;
  }): Promise<GatewayA2aTargetResource[]> {
    const rows = await this.prisma.gatewayA2ATarget.findMany({
      where: { organizationId: input.organizationId, projectId: input.projectId, archivedAt: null },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => this.#toResource(row));
  }

  async findById(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayA2aTargetResource | null> {
    const row = await this.prisma.gatewayA2ATarget.findFirst({
      where: { id: input.id, organizationId: input.organizationId, archivedAt: null },
    });
    return row ? this.#toResource(row) : null;
  }

  async create(
    input: CreateGatewayA2aTargetInput,
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayA2aTargetResource> {
    const parsed = createGatewayA2aTargetInputSchema.parse(input);
    const row = await this.#client(transaction)
      .gatewayA2ATarget.create({
        data: {
          id: generate("gateway").toString(),
          organizationId: parsed.organizationId,
          projectId: parsed.projectId,
          name: parsed.name,
          agentName: parsed.agentName,
          cardUrl: parsed.cardUrl,
          upstreamUrl: parsed.upstreamUrl,
          encryptedUpstreamHeaders: this.#seal(parsed.upstreamHeaders),
          restrictToAllowList: parsed.allowedVirtualKeyIds !== null,
          allowedVirtualKeyIds: parsed.allowedVirtualKeyIds ?? [],
          blocked: parsed.blocked,
          blockReason: parsed.blockReason,
          createdById: parsed.actorUserId,
        },
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) throw new GatewayA2aTargetNameTakenError(parsed.name);
        throw error;
      });
    return this.#toResource(row);
  }

  async update(
    input: GatewayA2aTargetUpdate,
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayA2aTargetResource> {
    const allowList = input.allowedVirtualKeyIds;
    const expected = input.expectedUpstream;
    const where = {
      id: input.id,
      organizationId: input.organizationId,
      // One statement checks the upstream the edit was checked against, so nothing slips between.
      ...(expected && {
        upstreamUrl: expected.upstreamUrl,
        encryptedUpstreamHeaders: expected.hasUpstreamHeaders ? { not: null } : null,
      }),
    };
    const row = await this.#client(transaction)
      .gatewayA2ATarget.update({
        where,
        data: {
          agentName: input.agentName,
          cardUrl: input.cardUrl,
          upstreamUrl: input.upstreamUrl,
          encryptedUpstreamHeaders:
            input.upstreamHeaders === undefined ? undefined : this.#seal(input.upstreamHeaders),
          restrictToAllowList: allowList === undefined ? undefined : allowList !== null,
          allowedVirtualKeyIds: allowList === undefined ? undefined : (allowList ?? []),
          blocked: input.blocked,
          blockReason: input.blockReason,
        },
      })
      .catch((error: unknown) => {
        if (expected && recordNotFoundSchema.validate(error)) {
          throw new GatewayA2aTargetHeadersNeedReplacingError();
        }
        throw error;
      });
    return this.#toResource(row);
  }

  async archive(
    input: { id: string; organizationId: string },
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayA2aTargetResource> {
    const row = await this.#client(transaction).gatewayA2ATarget.update({
      where: { id: input.id, organizationId: input.organizationId },
      data: { archivedAt: new Date() },
    });
    return this.#toResource(row);
  }

  #client(transaction?: GatewayPersistenceTransaction): Prisma.TransactionClient {
    return (transaction as Prisma.TransactionClient | undefined) ?? this.prisma;
  }

  #seal(headers: Record<string, string>): string | null {
    return Object.keys(headers).length === 0 ? null : this.cipher.encrypt(JSON.stringify(headers));
  }

  #toResource(row: A2aTargetRow, headers = true): GatewayA2aTargetResource {
    const { encryptedUpstreamHeaders, restrictToAllowList, allowedVirtualKeyIds, ...rest } = row;
    return gatewayA2aTargetResourceSchema.parse({
      ...rest,
      upstreamHeaders:
        headers && encryptedUpstreamHeaders
          ? gatewayA2aTargetHeadersSchema.parse(
              JSON.parse(this.cipher.decrypt(encryptedUpstreamHeaders)),
            )
          : {},
      allowedVirtualKeyIds: restrictToAllowList ? allowedVirtualKeyIds : null,
    });
  }
}

/** Prisma's answer when an update's `where` matched no row: here, a guard that no longer holds. */
const recordNotFoundSchema = z.object({ code: z.literal("P2025") });

/** Prisma reports the live-name index (`GatewayA2ATarget_live_name_key`) as `P2002`. */
const uniqueViolationSchema = z.object({
  code: z.literal("P2002"),
  meta: z.object({ target: z.unknown().optional() }).optional(),
});

/** A unique violation on the live-name index; one naming another index is not "name taken". */
function isUniqueViolation(error: unknown): boolean {
  const parsed = uniqueViolationSchema.safeParse(error);
  if (!parsed.success) return false;
  const target = parsed.data.meta?.target;
  if (target === undefined) return true;
  const names = (Array.isArray(target) ? target : [target]).map((name) => JSON.stringify(name));
  return names.some((name) => name === '"name"' || name.includes("live_name"));
}
