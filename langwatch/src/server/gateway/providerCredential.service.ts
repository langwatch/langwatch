/**
 * Business logic for gateway provider-credential bindings. A gateway provider
 * credential layers gateway-only settings (rate limits, rotation policy,
 * extra headers) on top of an existing project-scoped ModelProvider row —
 * the raw API key never leaves ModelProvider.
 */
import type {
  GatewayProviderCredential,
  ModelProvider,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";

import { GatewayAuditLogRepository } from "./auditLog.repository";
import { ChangeEventRepository } from "./changeEvent.repository";

export type GatewayProviderCredentialRow = GatewayProviderCredential & {
  modelProvider: ModelProvider;
};

export type CreateProviderCredentialInput = {
  projectId: string;
  organizationId: string;
  modelProviderId: string;
  slot?: string;
  rateLimitRpm?: number | null;
  rateLimitTpm?: number | null;
  rateLimitRpd?: number | null;
  rotationPolicy?: "AUTO" | "MANUAL" | "EXTERNAL_SECRET_STORE";
  extraHeaders?: Prisma.InputJsonValue | null;
  providerConfig?: Prisma.InputJsonValue | null;
  fallbackPriorityGlobal?: number | null;
  actorUserId: string;
};

export type UpdateProviderCredentialInput = Partial<CreateProviderCredentialInput> & {
  id: string;
  projectId: string;
  organizationId: string;
  actorUserId: string;
};

export class GatewayProviderCredentialService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly changeEvents = new ChangeEventRepository(prisma),
    private readonly auditLog = new GatewayAuditLogRepository(prisma),
  ) {}

  static create(prisma: PrismaClient): GatewayProviderCredentialService {
    return new GatewayProviderCredentialService(prisma);
  }

  async getAll(projectId: string): Promise<GatewayProviderCredentialRow[]> {
    return this.prisma.gatewayProviderCredential.findMany({
      where: { projectId },
      include: { modelProvider: true },
      orderBy: [{ fallbackPriorityGlobal: "asc" }, { createdAt: "asc" }],
    });
  }

  async getById(
    id: string,
    projectId: string,
  ): Promise<GatewayProviderCredentialRow | null> {
    return this.prisma.gatewayProviderCredential.findFirst({
      where: { id, projectId },
      include: { modelProvider: true },
    });
  }

  async create(
    input: CreateProviderCredentialInput,
  ): Promise<GatewayProviderCredentialRow> {
    const modelProvider = await this.prisma.modelProvider.findFirst({
      where: { id: input.modelProviderId, projectId: input.projectId },
    });
    if (!modelProvider) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "ModelProvider not found for this project",
      });
    }
    if (!modelProvider.enabled) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "ModelProvider is disabled. Enable it in Settings → Model Providers first.",
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.gatewayProviderCredential.create({
        data: {
          projectId: input.projectId,
          modelProviderId: input.modelProviderId,
          slot: input.slot ?? "primary",
          rateLimitRpm: input.rateLimitRpm ?? null,
          rateLimitTpm: input.rateLimitTpm ?? null,
          rateLimitRpd: input.rateLimitRpd ?? null,
          rotationPolicy: input.rotationPolicy ?? "MANUAL",
          extraHeaders: input.extraHeaders ?? undefined,
          providerConfig: input.providerConfig ?? undefined,
          fallbackPriorityGlobal: input.fallbackPriorityGlobal ?? null,
        },
        include: { modelProvider: true },
      });
      await this.changeEvents.append(
        {
          organizationId: input.organizationId,
          projectId: input.projectId,
          kind: "PROVIDER_BINDING_UPDATED",
          providerCredentialId: row.id,
        },
        tx,
      );
      await this.auditLog.append(
        {
          organizationId: input.organizationId,
          projectId: input.projectId,
          actorUserId: input.actorUserId,
          action: "PROVIDER_BINDING_CREATED",
          targetKind: "provider_binding",
          targetId: row.id,
          after: JSON.parse(JSON.stringify(row)),
        },
        tx,
      );
      return row;
    });
  }

  async update(
    input: UpdateProviderCredentialInput,
  ): Promise<GatewayProviderCredentialRow> {
    const existing = await this.getById(input.id, input.projectId);
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    const before = JSON.parse(JSON.stringify(existing));

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.gatewayProviderCredential.update({
        where: { id: input.id, projectId: input.projectId },
        data: {
          slot: input.slot ?? existing.slot,
          rateLimitRpm:
            input.rateLimitRpm !== undefined
              ? input.rateLimitRpm
              : existing.rateLimitRpm,
          rateLimitTpm:
            input.rateLimitTpm !== undefined
              ? input.rateLimitTpm
              : existing.rateLimitTpm,
          rateLimitRpd:
            input.rateLimitRpd !== undefined
              ? input.rateLimitRpd
              : existing.rateLimitRpd,
          rotationPolicy: input.rotationPolicy ?? existing.rotationPolicy,
          extraHeaders:
            input.extraHeaders !== undefined
              ? input.extraHeaders
              : existing.extraHeaders ?? undefined,
          providerConfig:
            input.providerConfig !== undefined
              ? input.providerConfig
              : existing.providerConfig ?? undefined,
          fallbackPriorityGlobal:
            input.fallbackPriorityGlobal !== undefined
              ? input.fallbackPriorityGlobal
              : existing.fallbackPriorityGlobal,
        },
        include: { modelProvider: true },
      });
      await this.changeEvents.append(
        {
          organizationId: input.organizationId,
          projectId: input.projectId,
          kind: "PROVIDER_BINDING_UPDATED",
          providerCredentialId: updated.id,
        },
        tx,
      );
      await this.auditLog.append(
        {
          organizationId: input.organizationId,
          projectId: input.projectId,
          actorUserId: input.actorUserId,
          action: "PROVIDER_BINDING_UPDATED",
          targetKind: "provider_binding",
          targetId: updated.id,
          before,
          after: JSON.parse(JSON.stringify(updated)),
        },
        tx,
      );
      return updated;
    });
  }

  async disable(args: {
    id: string;
    projectId: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<GatewayProviderCredentialRow> {
    const existing = await this.getById(args.id, args.projectId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
    const before = JSON.parse(JSON.stringify(existing));

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.gatewayProviderCredential.update({
        where: { id: args.id, projectId: args.projectId },
        data: { disabledAt: new Date() },
        include: { modelProvider: true },
      });
      await this.changeEvents.append(
        {
          organizationId: args.organizationId,
          projectId: args.projectId,
          kind: "PROVIDER_BINDING_UPDATED",
          providerCredentialId: updated.id,
        },
        tx,
      );
      await this.auditLog.append(
        {
          organizationId: args.organizationId,
          projectId: args.projectId,
          actorUserId: args.actorUserId,
          action: "PROVIDER_BINDING_UPDATED",
          targetKind: "provider_binding",
          targetId: updated.id,
          before,
          after: JSON.parse(JSON.stringify(updated)),
        },
        tx,
      );
      return updated;
    });
  }
}
