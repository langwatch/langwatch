/**
 * Business logic for virtual keys. Framework-agnostic (no tRPC / Hono imports).
 *
 * Every mutation runs inside a Prisma transaction that also appends a
 * GatewayChangeEvent (for the gateway's long-poll feed) and an AuditLog
 * row in gateway shape (for humans).
 *
 * VirtualKey is organization-scoped. Visibility is computed at read time
 * from `VirtualKeyScope` rows. Provider eligibility is computed from
 * those scope rows + an optional RoutingPolicy reference (see
 * `scopeResolver.ts`); the service does not own a per-VK provider chain.
 */
import { randomBytes } from "crypto";

import type { Prisma, PrismaClient, VirtualKey } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import { GatewayAuditAdapter } from "./auditLog.repository";
import { serializeRowForAudit } from "./auditSerializer";
import { ChangeEventRepository } from "./changeEvent.repository";
import {
  defaultVirtualKeyConfig,
  parseVirtualKeyConfig,
  virtualKeyConfigSchema,
  type GuardrailAttachment,
  type GuardrailDirection,
  type VirtualKeyConfig,
} from "./virtualKey.config";
import {
  hashVirtualKeySecret,
  mintVirtualKeySecret,
  parseVirtualKey,
} from "./virtualKey.crypto";
import {
  VirtualKeyRepository,
  type ScopeInput,
  type VirtualKeyWithScopes,
} from "./virtualKey.repository";

const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

export type CreateVirtualKeyInput = {
  organizationId: string;
  name: string;
  description?: string | null;
  principalUserId?: string | null;
  actorUserId: string;
  /**
   * Visibility set: every (scopeType, scopeId) the VK is reachable from.
   * At least one entry is required. Caller is responsible for asserting
   * `virtualKeys:manage` at each scope before calling.
   */
  scopes: ScopeInput[];
  /**
   * Optional RoutingPolicy reference. When set, the policy is the
   * authoritative ordering for the VK's eligible-MP chain at request
   * time. Policy must belong to `organizationId`.
   */
  routingPolicyId?: string | null;
  config?: Partial<VirtualKeyConfig>;
  /**
   * USER (default) for keys created via the gateway UI / API; LANGY when
   * auto-provisioned by the Langy services. Threaded straight to the row
   * column — no behaviour branches in the service itself.
   */
  purpose?: "USER" | "LANGY";
};

export type UpdateVirtualKeyInput = {
  id: string;
  organizationId: string;
  actorUserId: string;
  name?: string;
  description?: string | null;
  scopes?: ScopeInput[];
  routingPolicyId?: string | null;
  config?: Partial<VirtualKeyConfig>;
};

export type RotateVirtualKeyInput = {
  id: string;
  organizationId: string;
  actorUserId: string;
};

export type RevokeVirtualKeyInput = {
  id: string;
  organizationId: string;
  actorUserId: string;
};

export type CreatedVirtualKey = {
  virtualKey: VirtualKeyWithScopes;
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

  async getAll(organizationId: string): Promise<VirtualKeyWithScopes[]> {
    return this.repository.findAllInOrganization(organizationId);
  }

  async getAllForScope(scope: ScopeInput): Promise<VirtualKeyWithScopes[]> {
    return this.repository.findAllForScope(scope);
  }

  async getById(
    id: string,
    organizationId: string,
  ): Promise<VirtualKeyWithScopes | null> {
    return this.repository.findById(id, organizationId);
  }

  /** Used by the `/resolve-key` hot path — do not expose on public tRPC. */
  async getByHashedSecretInternal(
    hashedSecret: string,
  ): Promise<VirtualKeyWithScopes | null> {
    return this.repository.findByHashedSecret(hashedSecret);
  }

  async create(input: CreateVirtualKeyInput): Promise<CreatedVirtualKey> {
    if (input.scopes.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "At least one scope is required",
      });
    }
    const config = virtualKeyConfigSchema.parse({
      ...defaultVirtualKeyConfig(),
      ...(input.config ?? {}),
    });
    const secret = mintVirtualKeySecret();
    const { displayPrefix } = parseVirtualKey(secret);
    const hashedSecret = hashVirtualKeySecret(secret);

    if (input.routingPolicyId) {
      await this.assertRoutingPolicyBelongsToOrg(
        input.routingPolicyId,
        input.organizationId,
      );
    }

    const id = this.nextVirtualKeyId();

    const created = await this.prisma.$transaction(async (tx) => {
      const vk = await this.repository.create(
        {
          id,
          organizationId: input.organizationId,
          name: input.name,
          description: input.description,
          hashedSecret,
          displayPrefix,
          principalUserId: input.principalUserId,
          config: config as Prisma.InputJsonValue,
          createdById: input.actorUserId,
          scopes: input.scopes,
          routingPolicyId: input.routingPolicyId ?? null,
          purpose: input.purpose,
        },
        tx,
      );
      await this.changeEvents.append(
        {
          organizationId: input.organizationId,
          kind: "VK_CREATED",
          virtualKeyId: vk.id,
        },
        tx,
      );
      await this.auditLog.append(
        {
          organizationId: input.organizationId,
          projectId: null,
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

  async update(input: UpdateVirtualKeyInput): Promise<VirtualKeyWithScopes> {
    const existing = await this.requireOwn(input.id, input.organizationId);
    if (existing.status === "REVOKED") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot update a revoked virtual key",
      });
    }

    const before = serialiseForAudit(existing);
    const previousConfig = parseVirtualKeyConfig(existing.config);
    const config = input.config
      ? virtualKeyConfigSchema.parse({
          ...previousConfig,
          ...input.config,
        })
      : previousConfig;

    const guardrailDelta = diffGuardrailAttachments(
      previousConfig.guardrailAttachments,
      config.guardrailAttachments,
    );

    if (input.routingPolicyId) {
      await this.assertRoutingPolicyBelongsToOrg(
        input.routingPolicyId,
        input.organizationId,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.scopes) {
        if (input.scopes.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "At least one scope is required",
          });
        }
        await this.repository.replaceScopes(input.id, input.scopes, tx);
      }

      const vk = await tx.virtualKey.update({
        where: { id: input.id, organizationId: input.organizationId },
        data: {
          name: input.name ?? existing.name,
          description: input.description ?? existing.description,
          config: config as Prisma.InputJsonValue,
          ...(input.routingPolicyId !== undefined
            ? { routingPolicyId: input.routingPolicyId }
            : {}),
          revision: { increment: 1n },
        },
        include: { scopes: true },
      });

      await this.changeEvents.append(
        {
          organizationId: input.organizationId,
          kind: "VK_CONFIG_UPDATED",
          virtualKeyId: vk.id,
        },
        tx,
      );
      await this.auditLog.append(
        {
          organizationId: input.organizationId,
          projectId: null,
          actorUserId: input.actorUserId,
          action: "gateway.virtual_key.updated",
          targetKind: "virtual_key",
          targetId: vk.id,
          before,
          after: serialiseForAudit(vk),
        },
        tx,
      );
      // Guardrail attach/detach are governance events distinct from a
      // generic config edit; the AuditLog target stays the VK (the row
      // that opted in), not the guardrail. One row per added / removed
      // guardrail id so SIEM exports see each wire change individually.
      for (const a of guardrailDelta.attached) {
        await this.auditLog.append(
          {
            organizationId: input.organizationId,
            projectId: null,
            actorUserId: input.actorUserId,
            action: "gateway.virtual_key.guardrail_attached",
            targetKind: "virtual_key",
            targetId: vk.id,
            after: { direction: a.direction, guardrailId: a.guardrailId },
          },
          tx,
        );
      }
      for (const d of guardrailDelta.detached) {
        await this.auditLog.append(
          {
            organizationId: input.organizationId,
            projectId: null,
            actorUserId: input.actorUserId,
            action: "gateway.virtual_key.guardrail_detached",
            targetKind: "virtual_key",
            targetId: vk.id,
            before: { direction: d.direction, guardrailId: d.guardrailId },
          },
          tx,
        );
      }
      return vk;
    });

    return updated;
  }

  async rotate(input: RotateVirtualKeyInput): Promise<CreatedVirtualKey> {
    const existing = await this.requireOwn(input.id, input.organizationId);
    if (existing.status === "REVOKED") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot rotate a revoked virtual key",
      });
    }
    const before = serialiseForAudit(existing);
    const newSecret = mintVirtualKeySecret();
    const { displayPrefix: newDisplayPrefix } = parseVirtualKey(newSecret);
    const newHashedSecret = hashVirtualKeySecret(newSecret);
    const previousSecretValidUntil = new Date(Date.now() + ROTATION_GRACE_MS);

    const rotated = await this.prisma.$transaction(async (tx) => {
      const vk = await this.repository.rotateSecret(
        input.id,
        input.organizationId,
        newHashedSecret,
        newDisplayPrefix,
        existing.hashedSecret,
        previousSecretValidUntil,
        tx,
      );
      await this.changeEvents.append(
        {
          organizationId: input.organizationId,
          kind: "VK_ROTATED",
          virtualKeyId: vk.id,
        },
        tx,
      );
      await this.auditLog.append(
        {
          organizationId: input.organizationId,
          projectId: null,
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

  async revoke(input: RevokeVirtualKeyInput): Promise<VirtualKeyWithScopes> {
    const existing = await this.requireOwn(input.id, input.organizationId);
    if (existing.status === "REVOKED") return existing;
    const before = serialiseForAudit(existing);

    return this.prisma.$transaction(async (tx) => {
      const vk = await this.repository.revoke(
        input.id,
        input.organizationId,
        input.actorUserId,
        tx,
      );
      await this.changeEvents.append(
        {
          organizationId: input.organizationId,
          kind: "VK_REVOKED",
          virtualKeyId: vk.id,
        },
        tx,
      );
      await this.auditLog.append(
        {
          organizationId: input.organizationId,
          projectId: null,
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
    organizationId: string,
  ): Promise<VirtualKeyWithScopes> {
    const existing = await this.repository.findById(id, organizationId);
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Virtual key not found" });
    }
    return existing;
  }

  private async assertRoutingPolicyBelongsToOrg(
    routingPolicyId: string,
    organizationId: string,
  ): Promise<void> {
    const policy = await this.prisma.routingPolicy.findUnique({
      where: { id: routingPolicyId },
      select: { id: true, organizationId: true },
    });
    if (!policy) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Routing policy ${routingPolicyId} not found`,
      });
    }
    if (policy.organizationId !== organizationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "Routing policy belongs to a different organization than the virtual key",
      });
    }
  }

  private nextVirtualKeyId(): string {
    return `vk_${randomBytes(16).toString("base64url")}`;
  }
}

type GuardrailPair = { direction: GuardrailDirection; guardrailId: string };

/**
 * Flatten `[{direction, guardrailIds[]}]` tuples into per-(direction, id)
 * pairs and diff old vs new so the update path can emit one
 * attach/detach audit row per wire change.
 */
function diffGuardrailAttachments(
  before: GuardrailAttachment[],
  after: GuardrailAttachment[],
): { attached: GuardrailPair[]; detached: GuardrailPair[] } {
  const flatten = (attachments: GuardrailAttachment[]): Set<string> => {
    const set = new Set<string>();
    for (const a of attachments) {
      for (const id of a.guardrailIds) set.add(`${a.direction} ${id}`);
    }
    return set;
  };
  const toPair = (key: string): GuardrailPair => {
    const [direction, guardrailId] = key.split(" ");
    return {
      direction: direction as GuardrailDirection,
      guardrailId: guardrailId!,
    };
  };
  const beforeSet = flatten(before);
  const afterSet = flatten(after);
  const attached: GuardrailPair[] = [];
  const detached: GuardrailPair[] = [];
  for (const key of afterSet) {
    if (!beforeSet.has(key)) attached.push(toPair(key));
  }
  for (const key of beforeSet) {
    if (!afterSet.has(key)) detached.push(toPair(key));
  }
  return { attached, detached };
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
