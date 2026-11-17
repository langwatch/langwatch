import {
  GatewayA2aTargetNameTakenError,
  createGatewayA2aTargetInputSchema,
  gatewayA2aTargetHeadersSchema,
  gatewayA2aTargetResourceSchema,
  type CreateGatewayA2aTargetInput,
  type GatewayA2aTargetResource,
  type UpdateGatewayA2aTargetInput,
} from "@langwatch/gateway-contract";
import { generate } from "@langwatch/ksuid";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { GatewayA2aTargetRepository } from "../gateway-a2a-target.repository.ts";
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

  async findAll(organizationId: string): Promise<GatewayA2aTargetResource[]> {
    const rows = await this.prisma.gatewayA2ATarget.findMany({
      where: { organizationId, archivedAt: null },
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

  async create(input: CreateGatewayA2aTargetInput): Promise<GatewayA2aTargetResource> {
    const parsed = createGatewayA2aTargetInputSchema.parse(input);
    const row = await this.prisma.gatewayA2ATarget
      .create({
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

  async update(input: UpdateGatewayA2aTargetInput): Promise<GatewayA2aTargetResource> {
    const allowList = input.allowedVirtualKeyIds;
    const row = await this.prisma.gatewayA2ATarget.update({
      where: { id: input.id, organizationId: input.organizationId },
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
    });
    return this.#toResource(row);
  }

  async archive(input: { id: string; organizationId: string }): Promise<GatewayA2aTargetResource> {
    const row = await this.prisma.gatewayA2ATarget.update({
      where: { id: input.id, organizationId: input.organizationId },
      data: { archivedAt: new Date() },
    });
    return this.#toResource(row);
  }

  #seal(headers: Record<string, string>): string | null {
    return Object.keys(headers).length === 0 ? null : this.cipher.encrypt(JSON.stringify(headers));
  }

  #toResource(row: A2aTargetRow): GatewayA2aTargetResource {
    const { encryptedUpstreamHeaders, restrictToAllowList, allowedVirtualKeyIds, ...rest } = row;
    return gatewayA2aTargetResourceSchema.parse({
      ...rest,
      upstreamHeaders: encryptedUpstreamHeaders
        ? gatewayA2aTargetHeadersSchema.parse(
            JSON.parse(this.cipher.decrypt(encryptedUpstreamHeaders)),
          )
        : {},
      allowedVirtualKeyIds: restrictToAllowList ? allowedVirtualKeyIds : null,
    });
  }
}

/** Prisma reports the live-name index (`GatewayA2ATarget_live_name_key`) as `P2002`. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002";
}
