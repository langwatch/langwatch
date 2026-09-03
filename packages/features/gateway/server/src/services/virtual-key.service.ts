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

import { TRPCError } from "@trpc/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import type { ProjectService } from "@langwatch/project-contract";
import type {
  GatewayBudget,
  Prisma,
  PrismaClient,
  VirtualKey,
  VirtualKeyRoutingMode,
} from "@langwatch/prisma-client/generated";
import { GatewayAuditPort } from "../ports/gateway-audit.port";
import { gatewayRoutingPolicySelect } from "../adapters/gateway-routing-policy-select.adapter";
import {
  serializeRowForAudit,
  type GatewayAuditJson,
} from "../adapters/gateway-audit-serializer.adapter";
import { GatewayWindow } from "../adapters/gateway-window.adapter";
import { GatewayChangeEventsPort } from "../ports/gateway-change-events.port";
import { createGatewayAuditPort } from "../repositories/prisma/prisma.gateway-audit.repository";
import { createGatewayChangeEventsPort } from "../repositories/prisma/prisma.gateway-change-event.repository";
import {
  GatewayTraceProjectAmbiguousError,
  GatewayTraceProjectRequiredError,
  GatewayTraceProjectUnknownError,
  translateExternalIdConflict,
  VirtualKeyExpiryInPastError,
} from "../index";
import {
  identityPatchData,
  type ResourceMetadata,
} from "../adapters/gateway-resource-metadata.adapter";
import { scopeReachableModelProvidersForVk } from "../adapters/gateway-scope-resolver.adapter";
import {
  defaultVirtualKeyConfig,
  type GuardrailAttachment,
  type GuardrailDirection,
  parseVirtualKeyConfig,
  type VirtualKeyConfig,
  virtualKeyConfigSchema,
} from "@langwatch/gateway-contract";
import { VirtualKeyCryptoAdapter } from "../adapters/virtual-key-crypto.adapter";
import {
  type ScopeInput,
  type GatewayVirtualKeysPort,
  type VirtualKeyWithScopes,
} from "../ports/gateway-virtual-key.port";
import { createGatewayVirtualKeysPort } from "../repositories/prisma/prisma.virtual-key.repository";
import type { GatewayGovernanceSignalsPort } from "../ports/gateway-governance-signals.port";

const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Keys the product provisions and owns rather than the customer — today only
 * the Langy VK (`purpose: LANGY`). They remain addressable internally (the
 * gateway authenticates against them by hashed secret; Langy re-reads its own
 * config by column) but are absent from every customer-facing read and refuse
 * every customer-facing mutation.
 *
 * Refusing the mutations is the load-bearing part. `rotate` on a Langy VK
 * would hand the caller a fresh plaintext secret AND break Langy, because the
 * gateway keeps authenticating against the secret Langy still holds; `revoke`
 * and `update` are the same class of foot-gun. The settings UI already badges
 * and locks these rows, but that is presentation — this is the boundary.
 */
function isProductManaged(vk: Pick<VirtualKey, "purpose">): boolean {
  return vk.purpose !== "USER";
}

/**
 * The budget a key carries on itself, managed from the key's own drawer.
 * A key-targeted `GatewayBudget` is created in the same transaction as the
 * key, so a key can never exist for a moment with the cap its creator
 * asked for missing. `null` on update removes the cap (by archiving, never
 * deleting: the ledger behind it is spend history).
 *
 * The zod schema is the single validation source for this shape: the tRPC
 * mutations and the public REST API both parse through it, so the two
 * doors cannot accept different caps. Only the calendar windows a person
 * reasons about in a drawer: a per-minute cap on one key is an ops knob,
 * not a spending decision, and belongs on the budgets page.
 */
export const virtualKeyBudgetInputSchema = z.object({
  // A decimal number of dollars, strictly positive. String rather
  // than number to survive JSON round-trips without float drift; the
  // regex rejects partial parses ("10abs"), signs, and bare dots.
  limitUsd: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, "limitUsd must be a decimal number")
    .refine((v) => Number.parseFloat(v) > 0, {
      message: "limitUsd must be greater than zero",
    }),
  window: z.enum(["DAY", "WEEK", "MONTH"]),
  onBreach: z.enum(["BLOCK", "WARN"]).optional(),
  name: z.string().min(1).max(128).optional(),
});

export type VirtualKeyBudgetInput = z.infer<typeof virtualKeyBudgetInputSchema>;

export type CreateVirtualKeyInput = {
  organizationId: string;
  name: string;
  description?: string | null;
  principalUserId?: string | null;
  actorUserId: string;
  /** Optional cap created alongside the key, targeted at the key. */
  budget?: VirtualKeyBudgetInput | null;
  /** Defaults to NONE: a new key does not silently fail over. */
  routingMode?: VirtualKeyRoutingMode;
  /**
   * Visibility set: every (scopeType, scopeId) the VK is reachable from.
   * At least one entry is required. Caller is responsible for asserting
   * `virtualKeys:manage` at each scope before calling.
   */
  scopes: ScopeInput[];
  /** The caller's own id for this key; must be free within the organization. */
  externalId?: string | null;
  /** Customer-owned bookkeeping. Never read by the gateway. */
  metadata?: ResourceMetadata;
  /**
   * Where this key's traces and costs should land. NOT a scope: it grants
   * no visibility and no operate rights on the key. Omit it and the
   * destination is decided from what the key is scoped to; either way the
   * answer is stored on the key.
   */
  traceProjectId?: string | null;
  /**
   * Optional RoutingPolicy reference. When set, the policy is the
   * authoritative ordering for the VK's eligible-MP chain at request
   * time. Policy must belong to `organizationId`.
   */
  routingPolicyId?: string | null;
  /**
   * When the key stops serving. Absent or null means it never expires. A
   * date that has already passed is refused rather than stored: the key
   * would be dead on arrival and nothing about its first refusal would
   * point back at this field.
   */
  expiresAt?: Date | null;
  config?: Partial<VirtualKeyConfig>;
  /**
   * USER (default) for keys created via the gateway UI / API; LANGY when
   * auto-provisioned by the Langy services. Anything other than USER marks the
   * key product-managed, which hides it from customer-facing reads and makes
   * it refuse customer-facing mutations (see `isProductManaged`).
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
  /** Undefined leaves it alone; null clears it; a value claims it. */
  externalId?: string | null;
  /** Undefined leaves the stored map alone; a value REPLACES it wholesale. */
  metadata?: ResourceMetadata;
  /**
   * Undefined leaves the stored destination where it is, scope edits
   * included; a value moves it, validated as on create; null asks for it to
   * be worked out again from what the key is now.
   */
  traceProjectId?: string | null;
  routingPolicyId?: string | null;
  routingMode?: VirtualKeyRoutingMode;
  /**
   * Undefined leaves the expiration where it is; null clears it, so the key
   * never expires; a date moves it. Extending an expired key is the whole
   * reason expiry is a date rather than a status, so a key whose date has
   * already passed accepts this edit like any other.
   */
  expiresAt?: Date | null;
  config?: Partial<VirtualKeyConfig>;
  /**
   * Undefined leaves the key's budget alone; a value creates or updates
   * it; null archives it.
   */
  budget?: VirtualKeyBudgetInput | null;
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
    private readonly projects: ProjectService,
    private readonly repository: GatewayVirtualKeysPort,
    private readonly changeEvents: GatewayChangeEventsPort,
    private readonly auditLog: GatewayAuditPort,
    private readonly crypto: VirtualKeyCryptoAdapter,
    /**
     * The Enterprise governance ledger, when the deployment composes one.
     * Absent means the five lifecycle emissions below are not recorded —
     * exactly what the retired application did, which always constructed the
     * Enterprise service in its disabled form.
     */
    private readonly governanceSignals?: GatewayGovernanceSignalsPort,
  ) {}

  static create(
    prisma: PrismaClient,
    projects: ProjectService,
    crypto: VirtualKeyCryptoAdapter,
    governanceSignals?: GatewayGovernanceSignalsPort,
  ): VirtualKeyService {
    return new VirtualKeyService(
      prisma,
      projects,
      createGatewayVirtualKeysPort(prisma),
      createGatewayChangeEventsPort(prisma),
      createGatewayAuditPort(prisma),
      crypto,
      governanceSignals,
    );
  }

  static createForTest(prisma: PrismaClient, projects: ProjectService): VirtualKeyService {
    return VirtualKeyService.create(
      prisma,
      projects,
      VirtualKeyCryptoAdapter.create({ pepper: "test-virtual-key-pepper" }),
    );
  }

  async getAll(organizationId: string): Promise<VirtualKeyWithScopes[]> {
    return this.repository.findAllInOrganization(organizationId);
  }

  async listActiveForPrincipal(input: {
    organizationId: string;
    userId: string;
  }): Promise<VirtualKeyWithScopes[]> {
    const keys = await this.repository.findAllInOrganization(input.organizationId);

    return keys.filter((key) => key.principalUserId === input.userId && key.status !== "REVOKED");
  }

  /** One page of the organization's keys, newest first. */
  async getPage(args: {
    organizationId: string;
    limit: number;
    cursor: { createdAt: Date; id: string } | null;
    externalId?: string;
  }): Promise<VirtualKeyWithScopes[]> {
    return this.repository.findPageInOrganization(args);
  }

  async getAllForScope(scope: ScopeInput): Promise<VirtualKeyWithScopes[]> {
    return this.repository.findAllForScope(scope);
  }

  /**
   * Display names for the keys a page of spend rows names.
   *
   * The spend surfaces read ids out of the ClickHouse ledger and need a label
   * per id. It goes through this service — and therefore through
   * `findMetaByIds`, which selects three columns — because the alternative was
   * what the API process actually did: a `prisma.virtualKey.findMany` written
   * in its own gateway composition, on the table that carries every key's
   * hashed secret, its previous secret and the window that one stays valid in.
   *
   * Fenced by the owning organization even though the ids alone would find the
   * rows: a read that can only answer within one tenant cannot be made to leak
   * by a caller that assembled its id list somewhere unexpected. An empty id
   * list asks nothing and answers nothing.
   */
  async resolveNames(input: {
    organizationId: string;
    virtualKeyIds: readonly string[];
  }): Promise<Array<{ id: string; name: string }>> {
    const rows = await this.repository.findMetaByIds({
      organizationId: input.organizationId,
      ids: [...input.virtualKeyIds],
    });
    return rows.map((row) => ({ id: row.id, name: row.name }));
  }

  /**
   * Customer-facing single read. A product-managed key reports as absent
   * rather than forbidden — the caller has no legitimate use for one, and a
   * distinct error would confirm the id exists.
   */
  async getById(id: string, organizationId: string): Promise<VirtualKeyWithScopes | null> {
    const vk = await this.repository.tryFindById({ id, organizationId });
    if (!vk || isProductManaged(vk)) return null;
    return vk;
  }

  /** Used by the `/resolve-key` hot path — do not expose on public tRPC. */
  async getByHashedSecretInternal(hashedSecret: string): Promise<VirtualKeyWithScopes | null> {
    return this.repository.tryFindByHashedSecret(hashedSecret);
  }

  /** Used by internal Gateway transports after their format check succeeds. */
  async getBySecretInternal(secret: string): Promise<VirtualKeyWithScopes | null> {
    return this.getByHashedSecretInternal(this.crypto.hashSecret(secret));
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
    const secret = VirtualKeyCryptoAdapter.mintSecret();
    const { displayPrefix } = VirtualKeyCryptoAdapter.parseSecret(secret);
    const hashedSecret = this.crypto.hashSecret(secret);

    if (input.routingPolicyId) {
      await this.assertRoutingPolicyBelongsToOrg(input.routingPolicyId, input.organizationId);
    }
    const routingMode = resolveRoutingMode(input.routingMode, input.routingPolicyId ?? null);
    assertProvidersAllowedShape(input.config?.providersAllowed);
    assertExpiryInFuture({ expiresAt: input.expiresAt });

    const id = this.nextVirtualKeyId();

    const traceProjectId = await this.resolveStoredTraceDestination({
      organizationId: input.organizationId,
      scopes: input.scopes,
      traceProjectId: input.traceProjectId ?? null,
    });

    const created = await this.prisma
      .$transaction(async (tx) => {
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
            externalId: input.externalId ?? null,
            // Metadata REPLACES rather than merges: a merge cannot express
            // deleting a key without a sentinel. Absent leaves the stored map
            // alone; `{}` empties it.
            metadata: input.metadata,
            createdById: input.actorUserId,
            scopes: input.scopes,
            traceProjectId,
            expiresAt: input.expiresAt ?? null,
            routingPolicyId: input.routingPolicyId ?? null,
            routingMode,
            purpose: input.purpose,
          },
          tx,
        );
        await this.assertProvidersAllowedReachable(vk, config.providersAllowed, tx);
        if (input.budget) {
          await this.upsertKeyBudget(
            {
              virtualKey: vk,
              budget: input.budget,
              actorUserId: input.actorUserId,
            },
            tx,
          );
        }
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
      })
      // The unique index is what actually decides whether the external id was
      // free, so the refusal is read off its violation rather than off a
      // pre-flight SELECT that two concurrent creates would both pass.
      .catch((error: unknown) =>
        translateExternalIdConflict(error, "virtual_key", input.externalId),
      );

    await this.governanceSignals?.emitVirtualKeyLifecycle({
      virtualKey: created,
      action: "created",
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
      await this.assertRoutingPolicyBelongsToOrg(input.routingPolicyId, input.organizationId);
    }
    const nextRoutingPolicyId =
      input.routingPolicyId !== undefined
        ? input.routingPolicyId
        : input.routingMode !== undefined && input.routingMode !== "POLICY"
          ? // An explicit switch away from POLICY retires the stored
            // reference rather than tripping the pairing check below: the
            // caller stated the whole routing decision, and keeping the
            // old id would reject an update that is not contradictory.
            null
          : existing.routingPolicyId;
    const routingMode =
      input.routingMode !== undefined || input.routingPolicyId !== undefined
        ? resolveRoutingMode(input.routingMode ?? existing.routingMode, nextRoutingPolicyId)
        : existing.routingMode;
    assertProvidersAllowedShape(input.config?.providersAllowed);
    assertExpiryInFuture({ expiresAt: input.expiresAt });

    const traceProjectId = await this.nextStoredTraceDestination({ existing, input });

    const updated = await this.prisma
      .$transaction(async (tx) => {
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
            ...identityPatchData(input),
            ...(input.routingPolicyId !== undefined
              ? { routingPolicyId: input.routingPolicyId }
              : {}),
            ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
            traceProjectId,
            routingMode,
            revision: { increment: 1n },
          },
          // The same projection the virtual-key port materialises. Without
          // the two relations the row is not a `VirtualKeyWithScopes`: the
          // update would answer a key whose principal and routing policy
          // read as absent to everything downstream of it.
          include: {
            scopes: true,
            principalUser: { select: { id: true, name: true, email: true } },
            routingPolicy: { select: gatewayRoutingPolicySelect },
          },
        });

        await this.assertProvidersAllowedReachable(vk, config.providersAllowed, tx);

        if (input.budget !== undefined) {
          if (input.budget) {
            await this.upsertKeyBudget(
              {
                virtualKey: vk,
                budget: input.budget,
                actorUserId: input.actorUserId,
              },
              tx,
            );
          } else {
            await this.archiveKeyBudgets({
              vk,
              actorUserId: input.actorUserId,
              tx,
              include: "drawerManaged",
            });
          }
        }

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
      })
      .catch((error: unknown) =>
        translateExternalIdConflict(error, "virtual_key", input.externalId),
      );

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
    const newSecret = VirtualKeyCryptoAdapter.mintSecret();
    const { displayPrefix: newDisplayPrefix } = VirtualKeyCryptoAdapter.parseSecret(newSecret);
    const newHashedSecret = this.crypto.hashSecret(newSecret);
    const previousSecretValidUntil = new Date(Date.now() + ROTATION_GRACE_MS);

    const rotated = await this.prisma.$transaction(async (tx) => {
      const vk = await this.repository.rotateSecret(
        {
          id: input.id,
          organizationId: input.organizationId,
          newHashedSecret,
          newDisplayPrefix,
          previousHashedSecret: existing.hashedSecret,
          previousSecretValidUntil,
        },
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

    await this.governanceSignals?.emitVirtualKeyLifecycle({
      virtualKey: rotated,
      action: "rotated",
    });
    return { virtualKey: rotated, secret: newSecret };
  }

  async revoke(input: RevokeVirtualKeyInput): Promise<VirtualKeyWithScopes> {
    const existing = await this.requireOwn(input.id, input.organizationId);
    if (existing.status === "REVOKED") return existing;
    const before = serialiseForAudit(existing);

    return this.prisma
      .$transaction(async (tx) => {
        const vk = await this.repository.revoke(
          {
            id: input.id,
            organizationId: input.organizationId,
            revokedById: input.actorUserId,
          },
          tx,
        );
        // A dead key's cap is retired, not deleted: the ledger rows behind
        // it are the spend record, and an admin asking "what did this key
        // cost us before we killed it" needs the budget row to read them
        // against. Archiving also stops the budget from showing up as an
        // active control that nothing can ever spend against.
        await this.archiveKeyBudgets({
          vk,
          actorUserId: input.actorUserId,
          tx,
          include: "scopedToKey",
        });
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
      })
      .then(async (vk) => {
        await this.governanceSignals?.emitVirtualKeyLifecycle({
          virtualKey: vk,
          action: "revoked",
        });
        return vk;
      });
  }

  /**
   * Reversible stop. Unlike revoke: budgets stay active, rotation-grace
   * state stays intact, and the key material never changes, so enable
   * restores service exactly as it was. The distinct DISABLED status (and
   * its distinct auth error) is the whole point: a platform's kill switch
   * must be un-throwable and must never masquerade as a bad key.
   */
  async disable(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
    reason?: string | null;
  }): Promise<VirtualKeyWithScopes> {
    const existing = await this.requireOwn(input.id, input.organizationId);
    if (existing.status === "DISABLED") return existing;
    if (existing.status === "REVOKED") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A revoked key cannot be disabled; revocation is terminal.",
      });
    }
    const before = serialiseForAudit(existing);
    return this.prisma
      .$transaction(async (tx) => {
        const vk = await this.repository.setDisabled(
          {
            id: input.id,
            organizationId: input.organizationId,
            disabled: true,
            reason: input.reason ?? null,
          },
          tx,
        );
        await this.changeEvents.append(
          {
            organizationId: input.organizationId,
            kind: "VK_DISABLED",
            virtualKeyId: vk.id,
          },
          tx,
        );
        await this.auditLog.append(
          {
            organizationId: input.organizationId,
            projectId: null,
            actorUserId: input.actorUserId,
            action: "gateway.virtual_key.disabled",
            targetKind: "virtual_key",
            targetId: vk.id,
            before,
            after: serialiseForAudit(vk),
          },
          tx,
        );
        return vk;
      })
      .then(async (vk) => {
        await this.governanceSignals?.emitVirtualKeyLifecycle({
          virtualKey: vk,
          action: "disabled",
          reason: input.reason ?? null,
        });
        return vk;
      });
  }

  /** Reverse of disable: restores ACTIVE without touching anything else. */
  async enable(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<VirtualKeyWithScopes> {
    const existing = await this.requireOwn(input.id, input.organizationId);
    if (existing.status === "ACTIVE") return existing;
    if (existing.status === "REVOKED") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A revoked key cannot be enabled; mint a new key instead.",
      });
    }
    const before = serialiseForAudit(existing);
    return this.prisma
      .$transaction(async (tx) => {
        const vk = await this.repository.setDisabled(
          {
            id: input.id,
            organizationId: input.organizationId,
            disabled: false,
            reason: null,
          },
          tx,
        );
        await this.changeEvents.append(
          {
            organizationId: input.organizationId,
            kind: "VK_ENABLED",
            virtualKeyId: vk.id,
          },
          tx,
        );
        await this.auditLog.append(
          {
            organizationId: input.organizationId,
            projectId: null,
            actorUserId: input.actorUserId,
            action: "gateway.virtual_key.enabled",
            targetKind: "virtual_key",
            targetId: vk.id,
            before,
            after: serialiseForAudit(vk),
          },
          tx,
        );
        return vk;
      })
      .then(async (vk) => {
        await this.governanceSignals?.emitVirtualKeyLifecycle({
          virtualKey: vk,
          action: "enabled",
        });
        return vk;
      });
  }

  /** Advance `lastUsedAt` — called from resolve-key hot path. */
  async touchUsage(id: string): Promise<void> {
    await this.repository.recordUsage(id, new Date());
  }

  /**
   * Loads a key for mutation. Product-managed keys are rejected here rather
   * than in each caller, so `update` / `rotate` / `revoke` cannot drift apart
   * — NOT_FOUND for the same reason `getById` returns null.
   */
  private async requireOwn(id: string, organizationId: string): Promise<VirtualKeyWithScopes> {
    const existing = await this.repository.tryFindById({ id, organizationId });
    if (!existing || isProductManaged(existing)) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Virtual key not found",
      });
    }
    return existing;
  }

  /**
   * Create or update the budget targeted at this key. Runs inside the
   * caller's transaction so a key and the cap its creator asked for land
   * together or not at all: a key that exists for even a moment without
   * its cap is a key that can spend without one.
   */
  private async upsertKeyBudget(
    args: {
      virtualKey: VirtualKeyWithScopes;
      budget: VirtualKeyBudgetInput;
      actorUserId: string;
    },
    tx: Prisma.TransactionClient,
  ): Promise<GatewayBudget> {
    const { virtualKey: vk, budget, actorUserId } = args;
    // The drawer manages exactly one budget row, identified by explicit
    // linkage rather than by shape: matching on target/window would also
    // catch caps created independently on the Budgets page, whose
    // lifecycle (and delete permission) is not the drawer's to touch.
    const existing = await tx.gatewayBudget.findFirst({
      where: {
        organizationId: vk.organizationId,
        managedByVirtualKeyId: vk.id,
        archivedAt: null,
      },
    });

    const data = {
      name: budget.name ?? `${vk.name} budget`,
      window: budget.window,
      limitUsd: budget.limitUsd,
      onBreach: budget.onBreach ?? ("BLOCK" as const),
      // No timezone knob: enforcement computes resets in UTC only
      // (budgetWindow.ts), so accepting one here would store a setting
      // that changes nothing.
      timezone: null,
    };

    const row = existing
      ? await tx.gatewayBudget.update({
          where: { id: existing.id },
          data: {
            ...data,
            // Changing the window changes what "this period" means, so the
            // reset instant has to be recomputed with it.
            ...(existing.window !== budget.window
              ? { resetsAt: GatewayWindow.nextResetAt(budget.window) }
              : {}),
          },
        })
      : await tx.gatewayBudget.create({
          data: {
            ...data,
            organizationId: vk.organizationId,
            scopeType: "VIRTUAL_KEY",
            scopeId: vk.id,
            managedByVirtualKeyId: vk.id,
            createdById: actorUserId,
            resetsAt: GatewayWindow.nextResetAt(budget.window),
          },
        });

    await this.changeEvents.append(
      {
        organizationId: vk.organizationId,
        kind: existing ? "BUDGET_UPDATED" : "BUDGET_CREATED",
        budgetId: row.id,
        virtualKeyId: vk.id,
      },
      tx,
    );
    await this.auditLog.append(
      {
        organizationId: vk.organizationId,
        projectId: null,
        actorUserId,
        action: existing ? "gateway.budget.updated" : "gateway.budget.created",
        targetKind: "budget",
        targetId: row.id,
        ...(existing ? { before: serializeRowForAudit(existing) } : {}),
        after: serializeRowForAudit(row),
      },
      tx,
    );
    return row;
  }

  /**
   * Archive the budgets a key's lifecycle carries, which is a different set
   * depending on what just happened to the key.
   *
   * `drawerManaged` is the key still being alive: the drawer's budget field
   * was cleared, so that one row goes and nothing else does. Budgets created
   * independently on the Budgets page also target the key, but their
   * lifecycle carries its own permission (gatewayBudgets:delete); archiving
   * them from a key update would let virtualKeys:update silently remove an
   * admin's enforcement control.
   *
   * `scopedToKey` is the key being dead. REVOKED is terminal, so a budget
   * whose scope is this key and nothing else can never count spend or refuse
   * a request again, whoever created it. Leaving it active does not preserve
   * an enforcement control, because there is nothing left to enforce against;
   * it just leaves a row that reads as a live cap and shows up on the budgets
   * list warning that no key sends traffic to it. The permission argument
   * above does not carry over, because nothing is being taken away.
   *
   * Both cases archive rather than delete, so the ledger rows stay readable
   * against the cap they accrued under.
   */
  private async archiveKeyBudgets({
    vk,
    actorUserId,
    tx,
    include,
  }: {
    vk: VirtualKeyWithScopes;
    actorUserId: string;
    tx: Prisma.TransactionClient;
    include: "drawerManaged" | "scopedToKey";
  }): Promise<void> {
    const budgets = await tx.gatewayBudget.findMany({
      where: {
        organizationId: vk.organizationId,
        archivedAt: null,
        ...(include === "drawerManaged"
          ? { managedByVirtualKeyId: vk.id }
          : {
              OR: [
                { managedByVirtualKeyId: vk.id },
                // Scoped to this key and nothing else. ATTRIBUTED_USER counts
                // when the key is its anchor: the per-end-user allowance hangs
                // off the key's traffic, so a dead key means a template that
                // can never open another bucket. The same scope type anchored
                // on a project is untouched, and so is every PROJECT, TEAM or
                // ORGANIZATION budget, because those outlive any one key.
                {
                  scopeType: { in: ["VIRTUAL_KEY", "ATTRIBUTED_USER"] },
                  scopeId: vk.id,
                },
              ],
            }),
      },
    });
    for (const budget of budgets) {
      const archived = await tx.gatewayBudget.update({
        where: { id: budget.id },
        data: { archivedAt: new Date() },
      });
      await this.changeEvents.append(
        {
          organizationId: vk.organizationId,
          kind: "BUDGET_DELETED",
          budgetId: archived.id,
          virtualKeyId: vk.id,
        },
        tx,
      );
      await this.auditLog.append(
        {
          organizationId: vk.organizationId,
          projectId: null,
          actorUserId,
          action: "gateway.budget.deleted",
          targetKind: "budget",
          targetId: archived.id,
          before: serializeRowForAudit(budget),
          after: serializeRowForAudit(archived),
        },
        tx,
      );
    }
  }

  /**
   * Every key must SAY where its traces land, rather than have it guessed,
   * and the answer is written down rather than worked out again on each read.
   *
   * Per-key spend is read off the trace path, so the project a key traces
   * into is the project its spend is attributed to. The four cases live in
   * `ProjectService.resolveTraceDestination`; what belongs here is what each refusal means
   * to the person who asked for the key:
   *
   *   - `gateway_trace_project_unknown`: the destination named is not a live
   *     project of this organization. Deleted, or somebody else's.
   *   - `gateway_trace_project_ambiguous`: nothing was named while the
   *     organization has projects to choose from. The governance inbox would
   *     take the traffic and every project budget the creator had in mind
   *     would count none of it.
   *   - `trace_project_required`: nothing was named and there is no
   *     governance project either, so there is no destination to give.
   *
   * Revocation is intentionally not guarded: killing a key must always be
   * possible.
   *
   * Spec: specs/ai-gateway/virtual-key-creation.feature
   */
  private async resolveStoredTraceDestination(
    input: Pick<CreateVirtualKeyInput, "organizationId" | "scopes" | "traceProjectId">,
  ): Promise<string> {
    const decision = await this.projects.resolveTraceDestination({
      organizationId: input.organizationId,
      projectScopeIds: input.scopes
        .filter((scope) => scope.scopeType === "PROJECT")
        .map((scope) => scope.scopeId),
      traceProjectId: input.traceProjectId,
    });
    switch (decision.outcome) {
      case "resolved":
        return decision.project.id;
      case "unknown":
        throw new GatewayTraceProjectUnknownError();
      case "ambiguous":
        throw new GatewayTraceProjectAmbiguousError({
          projectScopeCount: decision.projectScopeCount,
        });
      case "no_destination":
        throw new GatewayTraceProjectRequiredError();
    }
  }

  /**
   * What an update leaves in the destination column.
   *
   * An untouched destination stays exactly where it is, including when the
   * edit moves the key's scopes around. Re-deriving it from the scopes is
   * what used to let an access change silently move where a key's money was
   * counted: two decisions, made on two screens, one of which never
   * mentioned the other.
   *
   * A destination that IS named on the update is validated the way create
   * validates it, so an edit can never point a key somewhere a create could
   * not. Clearing it (an explicit null) re-runs the whole decision, which is
   * the only way to say "work it out from what the key is now".
   *
   * The remaining case is a key that has no stored destination at all: one
   * written before the column was filled, in an organization that had no
   * governance project to fall back to. Those resolve like a create, so the
   * next touch either gives the key's traces a home or does not go through.
   */
  private async nextStoredTraceDestination(args: {
    existing: VirtualKeyWithScopes;
    input: UpdateVirtualKeyInput;
  }): Promise<string> {
    const { existing, input } = args;
    if (input.traceProjectId === undefined && existing.traceProjectId) {
      return existing.traceProjectId;
    }
    return this.resolveStoredTraceDestination({
      organizationId: input.organizationId,
      scopes: input.scopes ?? existing.scopes,
      traceProjectId: input.traceProjectId ?? null,
    });
  }

  /**
   * An explicit provider allowlist may only name providers the key can reach
   * through its SCOPE graph. It is validated against the scope-reachable set,
   * not the routing-policy-narrowed dispatch set: a provider the scope reaches
   * but the key's routing policy omits is still a valid allowlist entry,
   * because the policy blocks it at dispatch, not at save. Blocking the save
   * too would be over-strict. A provider the scope does not reach at all still
   * fails here, so a key can never point at another team's provider row.
   */
  private async assertProvidersAllowedReachable(
    vk: VirtualKeyWithScopes,
    providersAllowed: string[] | null,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (!providersAllowed) return;
    const reachable = await scopeReachableModelProvidersForVk(this.prisma, vk, tx);
    const reachableIds = new Set(reachable.map((mp) => mp.id));
    const unreachable = providersAllowed.filter((id) => !reachableIds.has(id));
    if (unreachable.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `providers_not_in_scope: ${unreachable.join(", ")}`,
      });
    }
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
        message: "Routing policy belongs to a different organization than the virtual key",
      });
    }
  }

  private nextVirtualKeyId(): string {
    return `vk_${randomBytes(16).toString("base64url")}`;
  }
}

/**
 * Reconcile the requested routing mode with the policy reference. The two
 * are one decision expressed in two columns, so the pairing is enforced
 * here rather than trusted from every caller: POLICY without a policy id
 * would silently route as if no policy existed, and NONE with a policy id
 * would leave a dangling reference that a later edit could resurrect.
 */
function resolveRoutingMode(
  requested: VirtualKeyRoutingMode | undefined,
  routingPolicyId: string | null,
): VirtualKeyRoutingMode {
  const mode = requested ?? (routingPolicyId ? "POLICY" : "NONE");
  if (mode === "POLICY" && !routingPolicyId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "routing_policy_required: routingMode POLICY needs a routingPolicyId",
    });
  }
  if (mode !== "POLICY" && routingPolicyId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `routing_policy_conflict: routingMode ${mode} cannot carry a routingPolicyId`,
    });
  }
  return mode;
}

/**
 * "No providers selected" is never a valid saved state. Absence means
 * every provider in scope; an empty list would mean a key that can serve
 * nothing, which is always a mis-click rather than an intent.
 */
function assertProvidersAllowedShape(providersAllowed: string[] | null | undefined): void {
  if (providersAllowed === undefined || providersAllowed === null) return;
  if (providersAllowed.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "providers_allowed_empty: select at least one provider, or allow all providers",
    });
  }
}

/**
 * A key is never written already expired.
 *
 * Absence leaves the stored date alone and null clears it, so only a real
 * date is checked. The comparison is against the moment of the write, which
 * makes "now" itself a refusal: a key that expires at the instant it is
 * saved serves nothing and reads as a bug in whatever wrote it.
 */
function assertExpiryInFuture({ expiresAt }: { expiresAt: Date | null | undefined }): void {
  if (!expiresAt) return;
  if (expiresAt.getTime() <= Date.now()) {
    throw new VirtualKeyExpiryInPastError();
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
      for (const id of a.guardrailIds) set.add(`${a.direction}\u0000${id}`);
    }
    return set;
  };
  const toPair = (key: string): GuardrailPair => {
    const [direction, guardrailId] = key.split("\u0000");
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

function serialiseForAudit(vk: VirtualKeyWithScopes): GatewayAuditJson {
  // Strip secret material. The base serializer already handles BigInt
  // (revision) safely — see auditSerializer.ts.
  const { hashedSecret, previousHashedSecret, ...safe } = vk;
  return serializeRowForAudit(safe as unknown as Record<string, unknown>);
}
