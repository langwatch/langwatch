/**
 * Business logic for virtual keys. Framework-agnostic (no tRPC / Hono imports).
 * Every mutation method runs inside a Prisma transaction that also appends a
 * GatewayChangeEvent (for the gateway's long-poll feed) and an
 * AuditLog row in gateway shape (for humans).
 */
import { randomBytes } from "crypto";

import type { PrismaClient, VirtualKey } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import { GatewayAuditAdapter } from "./auditLog.repository";
import { serializeRowForAudit } from "./auditSerializer";
import { ChangeEventRepository } from "./changeEvent.repository";
import {
  defaultVirtualKeyConfig,
  parseVirtualKeyConfig,
  virtualKeyConfigSchema,
  type VirtualKeyConfig,
} from "./virtualKey.config";
import {
  hashVirtualKeySecret,
  mintVirtualKeySecret,
  parseVirtualKey,
} from "./virtualKey.crypto";
import {
  VirtualKeyRepository,
  type VirtualKeyWithChain,
} from "./virtualKey.repository";

const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

export type CreateVirtualKeyInput = {
  projectId: string;
  organizationId: string;
  name: string;
  description?: string | null;
  environment: "live" | "test";
  principalUserId?: string | null;
  actorUserId: string;
  /**
   * GatewayProviderCredential IDs in fallback-chain order. Optional
   * (defaults to `[]`) — callers using `routingPolicyId` should omit
   * the field entirely; the policy is then the source of truth for
   * the chain and the gateway dispatcher resolves it at request time.
   */
  providerCredentialIds?: string[];
  config?: Partial<VirtualKeyConfig>;
  /**
   * Optional RoutingPolicy reference. When set:
   *   - `providerCredentialIds` may be empty (policy carries the chain)
   *   - The per-project ownership assertion on those IDs is skipped
   *     (policies are org-scoped and reference credentials that may
   *     live in other projects of the same org)
   *   - The VK row's routingPolicyId column is set in the same
   *     transaction so create + bind are atomic
   */
  routingPolicyId?: string | null;
};

export type UpdateVirtualKeyInput = {
  id: string;
  projectId: string;
  organizationId: string;
  actorUserId: string;
  name?: string;
  description?: string | null;
  providerCredentialIds?: string[];
  config?: Partial<VirtualKeyConfig>;
};

export type RotateVirtualKeyInput = {
  id: string;
  projectId: string;
  organizationId: string;
  actorUserId: string;
};

export type RevokeVirtualKeyInput = {
  id: string;
  projectId: string;
  organizationId: string;
  actorUserId: string;
};

export type CreatedVirtualKey = {
  virtualKey: VirtualKeyWithChain;
  /** Raw secret — exposed to the caller once and never persisted. */
  secret: string;
};

/**
 * `VirtualKeyService` owns the write-path invariants:
 *
 * - Secret minting + hashing, display-prefix extraction.
 * - Atomic revision bump + GatewayChangeEvent append so the Go gateway
 *   eventually sees every mutation via its long-poll.
 * - Audit log entry on every mutation.
 * - RBAC is enforced by tRPC / Hono layers before reaching the service.
 */
export class VirtualKeyService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: VirtualKeyRepository,
    private readonly changeEvents: ChangeEventRepository,
    private readonly auditLog: GatewayAuditAdapter,
  ) {}

  static create(prisma: PrismaClient): VirtualKeyService {
    return new VirtualKeyService(
      prisma,
      new VirtualKeyRepository(prisma),
      new ChangeEventRepository(prisma),
      new GatewayAuditAdapter(prisma),
    );
  }

  async getAll(projectId: string): Promise<VirtualKeyWithChain[]> {
    return this.repository.findAll(projectId);
  }

  async getById(
    id: string,
    projectId: string,
  ): Promise<VirtualKeyWithChain | null> {
    return this.repository.findById(id, projectId);
  }

  /** Used by the `/resolve-key` hot path — do not expose on public tRPC. */
  async getByHashedSecretInternal(
    hashedSecret: string,
  ): Promise<VirtualKeyWithChain | null> {
    return this.repository.findByHashedSecret(hashedSecret);
  }

  async create(input: CreateVirtualKeyInput): Promise<CreatedVirtualKey> {
    const config = virtualKeyConfigSchema.parse({
      ...defaultVirtualKeyConfig(),
      ...(input.config ?? {}),
    });
    const secret = mintVirtualKeySecret(input.environment);
    const { displayPrefix } = parseVirtualKey(secret);
    const hashedSecret = hashVirtualKeySecret(secret);

    // Validate authorization for the provider chain.
    //
    // Two paths, both bounded:
    //
    // 1. Direct chain (no routingPolicyId): caller-supplied credential
    //    IDs must belong to `input.projectId`.
    //
    // 2. Policy-bound (routingPolicyId set): the policy is the source
    //    of truth for the chain, so we don't accept caller-supplied
    //    credential IDs at all (`providerCredentialIds` MUST be empty).
    //    The policy itself must belong to `input.organizationId` —
    //    cross-org reuse is the exact privilege-escalation we're
    //    guarding against. Per-project ownership of the policy's
    //    credentials is enforced at policy create/update time by
    //    RoutingPolicyService, not re-checked here.
    const providerCredentialIds = input.providerCredentialIds ?? [];
    if (input.routingPolicyId) {
      if (providerCredentialIds.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "providerCredentialIds must be empty when routingPolicyId is set — the policy carries the chain",
        });
      }
      const policy = await this.prisma.routingPolicy.findUnique({
        where: { id: input.routingPolicyId },
        select: { id: true, organizationId: true },
      });
      if (!policy) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Routing policy ${input.routingPolicyId} not found`,
        });
      }
      if (policy.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Routing policy belongs to a different organization than the virtual key",
        });
      }
    } else {
      await this.assertProviderCredentialsBelongToProject(
        input.projectId,
        providerCredentialIds,
      );
    }

    const id = this.nextVirtualKeyId();
    const providerChain = providerCredentialIds.map((credId, index) => ({
      id: credId,
      priority: index,
    }));

    const created = await this.prisma.$transaction(async (tx) => {
      const vk = await this.repository.create(
        {
          id,
          projectId: input.projectId,
          name: input.name,
          description: input.description,
          environment: input.environment === "live" ? "LIVE" : "TEST",
          hashedSecret,
          displayPrefix,
          principalUserId: input.principalUserId,
          config: config as Prisma.InputJsonValue,
          createdById: input.actorUserId,
          providerCredentialIds: providerChain,
        },
        tx,
      );
      // Bind the routing policy in the same tx so create + bind is
      // atomic and the dispatcher never observes a half-configured VK.
      // projectId is required in the where clause to satisfy
      // dbMultiTenancyProtection — VirtualKey is a project-scoped model
      // and the middleware rejects updates that don't scope by it.
      if (input.routingPolicyId) {
        await tx.virtualKey.update({
          where: { id: vk.id, projectId: input.projectId },
          data: { routingPolicyId: input.routingPolicyId },
        });
        vk.routingPolicyId = input.routingPolicyId;
      }
      await this.changeEvents.append(
        {
          organizationId: input.organizationId,
          projectId: input.projectId,
          kind: "VK_CREATED",
          virtualKeyId: vk.id,
        },
        tx,
      );
      await this.auditLog.append(
        {
          organizationId: input.organizationId,
          projectId: input.projectId,
          actorUserId: input.actorUserId,
          action: "gateway.virtual_key.created",
          targetKind: "virtual_key",
          targetId: vk.id,
          after: serialiseForAudit(vk),
        },
        tx,
      );
      return vk;
    });

    return { virtualKey: created, secret };
  }

  async update(input: UpdateVirtualKeyInput): Promise<VirtualKeyWithChain> {
    const existing = await this.requireOwn(input.id, input.projectId);
    if (existing.status === "REVOKED") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot update a revoked virtual key",
      });
    }

    const before = serialiseForAudit(existing);
    const config = input.config
      ? virtualKeyConfigSchema.parse({
          ...parseVirtualKeyConfig(existing.config),
          ...input.config,
        })
      : parseVirtualKeyConfig(existing.config);

    if (input.providerCredentialIds) {
      await this.assertProviderCredentialsBelongToProject(
        input.projectId,
        input.providerCredentialIds,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.providerCredentialIds) {
        const chain = input.providerCredentialIds.map((credId, index) => ({
          id: credId,
          priority: index,
        }));
        await this.repository.replaceProviderChain(input.id, chain, tx);
      }

      const vk = await tx.virtualKey.update({
        where: { id: input.id, projectId: input.projectId },
        data: {
          name: input.name ?? existing.name,
          description: input.description ?? existing.description,
          config: config as Prisma.InputJsonValue,
          revision: { increment: 1n },
        },
        include: { providerCredentials: { orderBy: { priority: "asc" } } },
      });

      await this.changeEvents.append(
        {
          organizationId: input.organizationId,
          projectId: input.projectId,
          kind: "VK_CONFIG_UPDATED",
          virtualKeyId: vk.id,
        },
        tx,
      );
      await this.auditLog.append(
        {
          organizationId: input.organizationId,
          projectId: input.projectId,
          actorUserId: input.actorUserId,
          action: "gateway.virtual_key.updated",
          targetKind: "virtual_key",
          targetId: vk.id,
          before,
          after: serialiseForAudit(vk),
        },
        tx,
      );
      return vk;
    });

    return updated;
  }

  async rotate(input: RotateVirtualKeyInput): Promise<CreatedVirtualKey> {
    const existing = await this.requireOwn(input.id, input.projectId);
    if (existing.status === "REVOKED") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot rotate a revoked virtual key",
      });
    }
    const before = serialiseForAudit(existing);
    const newSecret = mintVirtualKeySecret(
      existing.environment === "LIVE" ? "live" : "test",
    );
    const { displayPrefix: newDisplayPrefix } = parseVirtualKey(newSecret);
    const newHashedSecret = hashVirtualKeySecret(newSecret);
    const previousSecretValidUntil = new Date(Date.now() + ROTATION_GRACE_MS);

    const rotated = await this.prisma.$transaction(async (tx) => {
      const vk = await this.repository.rotateSecret(
        input.id,
        input.projectId,
        newHashedSecret,
        newDisplayPrefix,
        existing.hashedSecret,
        previousSecretValidUntil,
        tx,
      );
      await this.changeEvents.append(
        {
          organizationId: input.organizationId,
          projectId: input.projectId,
          kind: "VK_ROTATED",
          virtualKeyId: vk.id,
        },
        tx,
      );
      await this.auditLog.append(
        {
          organizationId: input.organizationId,
          projectId: input.projectId,
          actorUserId: input.actorUserId,
          action: "gateway.virtual_key.rotated",
          targetKind: "virtual_key",
          targetId: vk.id,
          before,
          after: serialiseForAudit(vk),
        },
        tx,
      );
      return vk;
    });

    return { virtualKey: rotated, secret: newSecret };
  }

  async revoke(input: RevokeVirtualKeyInput): Promise<VirtualKeyWithChain> {
    const existing = await this.requireOwn(input.id, input.projectId);
    if (existing.status === "REVOKED") return existing;
    const before = serialiseForAudit(existing);

    return this.prisma.$transaction(async (tx) => {
      const vk = await this.repository.revoke(
        input.id,
        input.projectId,
        input.actorUserId,
        tx,
      );
      await this.changeEvents.append(
        {
          organizationId: input.organizationId,
          projectId: input.projectId,
          kind: "VK_REVOKED",
          virtualKeyId: vk.id,
        },
        tx,
      );
      await this.auditLog.append(
        {
          organizationId: input.organizationId,
          projectId: input.projectId,
          actorUserId: input.actorUserId,
          action: "gateway.virtual_key.revoked",
          targetKind: "virtual_key",
          targetId: vk.id,
          before,
          after: serialiseForAudit(vk),
        },
        tx,
      );
      return vk;
    });
  }

  /** Advance `lastUsedAt` — called from resolve-key hot path. */
  async touchUsage(id: string): Promise<void> {
    await this.repository.recordUsage(id, new Date());
  }

  private async requireOwn(
    id: string,
    projectId: string,
  ): Promise<VirtualKeyWithChain> {
    const existing = await this.repository.findById(id, projectId);
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Virtual key not found" });
    }
    return existing;
  }

  private async assertProviderCredentialsBelongToProject(
    projectId: string,
    credentialIds: string[],
  ): Promise<void> {
    if (credentialIds.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "At least one provider credential is required",
      });
    }
    const count = await this.prisma.gatewayProviderCredential.count({
      where: { projectId, id: { in: credentialIds }, disabledAt: null },
    });
    if (count !== credentialIds.length) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "One or more provider credentials do not belong to this project or are disabled",
      });
    }
  }

  private nextVirtualKeyId(): string {
    return `vk_${randomBytes(16).toString("base64url")}`;
  }
}

function serialiseForAudit(vk: VirtualKey): Prisma.InputJsonValue {
  // Strip secret material. The base serializer already handles BigInt
  // (revision) safely — see auditSerializer.ts.
  const { hashedSecret, previousHashedSecret, ...safe } = vk as VirtualKey & {
    hashedSecret: string;
    previousHashedSecret: string | null;
  };
  return serializeRowForAudit(safe as unknown as Record<string, unknown>);
}
