/**
 * Business logic for gateway provider-credential bindings. A gateway provider
 * credential layers gateway-only settings (rate limits, rotation policy,
 * extra headers) on top of an existing project-scoped ModelProvider row —
 * the raw API key never leaves ModelProvider.
 */
import {
  Prisma,
  type GatewayProviderCredential,
  type ModelProvider,
  type PrismaClient,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";

import { GatewayAuditAdapter } from "./auditLog.repository";
import { serializeRowForAudit } from "./auditSerializer";
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
  // v1 ships MANUAL only; AUTO + EXTERNAL_SECRET_STORE are v1.1 scope.
  // Kept on the type so the column continues to accept writes, but
  // callers have no reason to set anything other than the default.
  rotationPolicy?: "MANUAL";
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
    private readonly auditLog = new GatewayAuditAdapter(prisma),
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

  /**
   * G19 — list every gateway provider credential reachable from any project
   * in the org. Used by org-scoped pickers (routing-policy drawer) where
   * the admin needs to choose credentials regardless of which project they
   * happen to be defined under. Two-step query mirrors
   * routingPolicy.service.assertProviderCredentialsBelongToOrg — the
   * dbMultiTenancyProtection middleware refuses any direct query against
   * gatewayProviderCredential without projectId in the WHERE clause.
   */
  async getAllForOrg(
    organizationId: string,
  ): Promise<GatewayProviderCredentialRow[]> {
    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);
    if (projectIds.length === 0) return [];
    return this.prisma.gatewayProviderCredential.findMany({
      where: { projectId: { in: projectIds } },
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
    // G116 — ModelProvider is multi-scope (iter 109): an org-scoped MP
    // is reachable from any project in the org via the
    // ModelProviderScope join, but its own `projectId` column points
    // at whichever project originally minted it. Looking the MP up by
    // `(id, projectId)` therefore drops org/team-scoped rows on the
    // floor — the bind drawer's dropdown lists them (correctly via
    // `findAllAccessibleForProject`) so the admin sees a 'NOT_FOUND'
    // mismatch only after clicking Bind. Walk the scope ladder
    // (PROJECT → TEAM → ORGANIZATION) instead, mirroring the
    // repository helper. Tenancy boundary still holds: we resolve the
    // caller's project to its team + org once, and only consider MPs
    // whose scope grant matches one of those three IDs.
    const project = await this.prisma.project.findUnique({
      where: { id: input.projectId },
      select: {
        id: true,
        teamId: true,
        team: { select: { organizationId: true } },
      },
    });
    if (!project) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Project not found",
      });
    }
    const modelProvider = await this.prisma.modelProvider.findFirst({
      where: {
        id: input.modelProviderId,
        scopes: {
          some: {
            OR: [
              { scopeType: "PROJECT", scopeId: project.id },
              { scopeType: "TEAM", scopeId: project.teamId },
              {
                scopeType: "ORGANIZATION",
                scopeId: project.team.organizationId,
              },
            ],
          },
        },
      },
    });
    if (!modelProvider) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "ModelProvider not accessible from this project",
      });
    }
    if (!modelProvider.enabled) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "ModelProvider is disabled. Enable it in Settings → Model Providers first.",
      });
    }

    const slot = input.slot ?? "primary";
    return this.prisma.$transaction(async (tx) => {
      // G115 — `(projectId, modelProviderId, slot)` is a hard unique
      // constraint independent of `disabledAt`. If a soft-disabled row
      // already occupies this tuple, the bind would fail with a P2002.
      // The user clicked "Bind", which they consider a fresh action;
      // the right outcome is to revive the existing row with the new
      // settings rather than ask them to navigate elsewhere first.
      const conflicting = await tx.gatewayProviderCredential.findUnique({
        where: {
          projectId_modelProviderId_slot: {
            projectId: input.projectId,
            modelProviderId: input.modelProviderId,
            slot,
          },
        },
        include: { modelProvider: true },
      });
      if (conflicting) {
        if (conflicting.disabledAt === null) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A binding for this provider at slot "${slot}" already exists`,
          });
        }
        const before = serializeRowForAudit(conflicting);
        const revived = await tx.gatewayProviderCredential.update({
          where: { id: conflicting.id, projectId: input.projectId },
          data: {
            disabledAt: null,
            slot,
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
            providerCredentialId: revived.id,
          },
          tx,
        );
        await this.auditLog.append(
          {
            organizationId: input.organizationId,
            projectId: input.projectId,
            actorUserId: input.actorUserId,
            action: "gateway.provider_binding.created",
            targetKind: "provider_binding",
            targetId: revived.id,
            before,
            after: serializeRowForAudit(revived),
          },
          tx,
        );
        return revived;
      }

      const row = await tx.gatewayProviderCredential.create({
        data: {
          projectId: input.projectId,
          modelProviderId: input.modelProviderId,
          slot,
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
          action: "gateway.provider_binding.created",
          targetKind: "provider_binding",
          targetId: row.id,
          after: serializeRowForAudit(row),
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
    const before = serializeRowForAudit(existing);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.gatewayProviderCredential.update({
        where: { id: input.id },
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
              ? (input.extraHeaders ?? Prisma.JsonNull)
              : (existing.extraHeaders as Prisma.InputJsonValue | undefined) ??
                Prisma.JsonNull,
          providerConfig:
            input.providerConfig !== undefined
              ? (input.providerConfig ?? Prisma.JsonNull)
              : (existing.providerConfig as Prisma.InputJsonValue | undefined) ??
                Prisma.JsonNull,
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
          action: "gateway.provider_binding.updated",
          targetKind: "provider_binding",
          targetId: updated.id,
          before,
          after: serializeRowForAudit(updated),
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * Cascade-disable every GatewayProviderCredential row bound to the
   * given ModelProvider. Invoked by ModelProviderService when an admin
   * flips the MP's `enabled` to false (G88/G89 follow-up — without
   * this, soft-disabling the MP leaves visible binding rows that look
   * routable but route through a disabled provider).
   *
   * Idempotent — rows already `disabledAt != null` are skipped so a
   * re-disable doesn't churn audit logs / change events. Returns the
   * count of rows actually flipped this call so the caller can
   * surface "N bindings disabled along with the provider" if needed.
   *
   * Skips per-row audit-log writes for the cascade itself; the audit
   * trail of the parent ModelProvider disable is the discoverable
   * story. The change-event stream still fires per row so the gateway
   * dispatcher's warm cache invalidates correctly.
   */
  async disableAllForModelProvider(args: {
    modelProviderId: string;
    projectId: string;
    organizationId: string;
    actorUserId: string;
    tx?: Prisma.TransactionClient;
  }): Promise<number> {
    const exec = async (
      tx: Prisma.TransactionClient,
    ): Promise<number> => {
      const candidates = await tx.gatewayProviderCredential.findMany({
        where: {
          projectId: args.projectId,
          modelProviderId: args.modelProviderId,
          disabledAt: null,
        },
        select: { id: true },
      });
      if (candidates.length === 0) return 0;

      const result = await tx.gatewayProviderCredential.updateMany({
        where: {
          projectId: args.projectId,
          id: { in: candidates.map((c) => c.id) },
        },
        data: { disabledAt: new Date() },
      });

      // One change event per row so the dispatcher's warm cache
      // invalidates each binding individually (the warm-cache key is
      // per-credential, not per-MP).
      for (const candidate of candidates) {
        await this.changeEvents.append(
          {
            organizationId: args.organizationId,
            projectId: args.projectId,
            kind: "PROVIDER_BINDING_UPDATED",
            providerCredentialId: candidate.id,
          },
          tx,
        );
      }
      return result.count;
    };
    return args.tx ? exec(args.tx) : this.prisma.$transaction(exec);
  }

  async disable(args: {
    id: string;
    projectId: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<GatewayProviderCredentialRow> {
    const existing = await this.getById(args.id, args.projectId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
    const before = serializeRowForAudit(existing);

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
          action: "gateway.provider_binding.updated",
          targetKind: "provider_binding",
          targetId: updated.id,
          before,
          after: serializeRowForAudit(updated),
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * G93 — recover a disabled binding by clearing `disabledAt`. Mirror of
   * `disable`; emits the same change-event + audit trail with the
   * `enabled` action so the gateway dispatcher's warm cache picks up
   * the row again.
   */
  async enable(args: {
    id: string;
    projectId: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<GatewayProviderCredentialRow> {
    const existing = await this.getById(args.id, args.projectId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
    const before = serializeRowForAudit(existing);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.gatewayProviderCredential.update({
        where: { id: args.id, projectId: args.projectId },
        data: { disabledAt: null },
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
          action: "gateway.provider_binding.updated",
          targetKind: "provider_binding",
          targetId: updated.id,
          before,
          after: serializeRowForAudit(updated),
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * G93 — hard delete. Used by admins to clear a binding row entirely
   * (so its (projectId, modelProviderId, slot) tuple frees up for a
   * fresh bind). Cascades to `VirtualKeyProviderCredential` via the
   * Prisma onDelete:Cascade on that join — VKs that referenced this
   * binding lose the reference and (per existing chain validation)
   * fail closed at request time. Soft-disable remains the default
   * surface; this is the explicit-recovery escape hatch.
   */
  async destroy(args: {
    id: string;
    projectId: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<{ id: string }> {
    const existing = await this.getById(args.id, args.projectId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
    const before = serializeRowForAudit(existing);

    return this.prisma.$transaction(async (tx) => {
      await tx.gatewayProviderCredential.delete({
        where: { id: args.id, projectId: args.projectId },
      });
      await this.changeEvents.append(
        {
          organizationId: args.organizationId,
          projectId: args.projectId,
          kind: "PROVIDER_BINDING_UPDATED",
          providerCredentialId: args.id,
        },
        tx,
      );
      await this.auditLog.append(
        {
          organizationId: args.organizationId,
          projectId: args.projectId,
          actorUserId: args.actorUserId,
          action: "gateway.provider_binding.deleted",
          targetKind: "provider_binding",
          targetId: args.id,
          before,
        },
        tx,
      );
      return { id: args.id };
    });
  }
}
