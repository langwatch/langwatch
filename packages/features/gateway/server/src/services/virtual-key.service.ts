/**
 * Business logic for virtual keys. Framework-agnostic (no tRPC / Hono imports).
 * Every mutation appends a GatewayChangeEvent and an AuditLog row inside one
 * Prisma transaction. VirtualKey is organization-scoped.
 */

import { TRPCError } from "@trpc/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import type { ProjectService } from "@langwatch/project-contract";
import type {
  GatewayBudget,
  VirtualKey,
  VirtualKeyRoutingMode,
} from "@langwatch/gateway-contract";
import { GatewayAuditPort } from "../ports/gateway-audit.port";
import {
  serializeRowForAudit,
  type GatewayAuditJson,
  GatewayWindow,
  defaultVirtualKeyConfig,
  type GuardrailAttachment,
  type GuardrailDirection,
  parseVirtualKeyConfig,
  type VirtualKeyConfig,
  virtualKeyConfigSchema,
  identityPatchData,
  type ResourceMetadata,
} from "@langwatch/gateway-contract";
import { GatewayChangeEventsPort } from "../ports/gateway-change-events.port";
import {
  GatewayTraceProjectAmbiguousError,
  GatewayTraceProjectRequiredError,
  GatewayTraceProjectUnknownError,
  translateExternalIdConflict,
  VirtualKeyExpiryInPastError,
} from "../index";
import type { GatewayScopeResolutionService } from "./gateway-scope-resolution.service";
import type { GatewayPersistenceTransaction } from "../ports/gateway-change-events.port";
import type { GatewayTransactionPort } from "../ports/gateway-transaction.port";
import type {
  GatewayKeyBudgetRepository,
  GatewayKeyBudgetScope,
} from "../repositories/gateway-key-budget.repository";
import { GatewayVirtualKeyCryptoPort } from "../ports/gateway-virtual-key-crypto.port";
import {
  type ScopeInput,
  type GatewayVirtualKeysPort,
  type VirtualKeyWithScopes,
} from "../ports/gateway-virtual-key.port";
import type { GatewayGovernanceSignalsPort } from "../ports/gateway-governance-signals.port";

const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Keys the product provisions and owns rather than the customer — today only
 * the Langy VK. Absent from customer-facing reads; refuses customer-facing
 * mutations (`rotate` would break Langy's own auth against the secret).
 */
function isProductManaged(vk: Pick<VirtualKey, "purpose">): boolean {
  return vk.purpose !== "USER";
}

/**
 * The budget a key carries on itself, created in the same transaction as the
 * key. `null` on update removes the cap by archiving. The zod schema is the
 * single validation source, shared by tRPC and REST.
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
   * Where this key's traces and costs should land. NOT a scope: it grants no
   * visibility or operate rights. Omit it and the destination is decided from
   * what the key is scoped to; either way the answer is stored on the key.
   */
  traceProjectId?: string | null;
  /**
   * Optional RoutingPolicy reference. When set, the policy is the
   * authoritative ordering for the VK's eligible-MP chain at request
   * time. Policy must belong to `organizationId`.
   */
  routingPolicyId?: string | null;
  /**
   * When the key stops serving. Absent or null means it never expires. A date
   * that has already passed is refused rather than stored: the key would be
   * dead on arrival.
   */
  expiresAt?: Date | null;
  config?: Partial<VirtualKeyConfig>;
  /**
   * USER (default) for keys created via the gateway UI/API; LANGY when
   * auto-provisioned by Langy. Anything other than USER marks the key
   * product-managed (see `isProductManaged`).
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
   * Undefined leaves the expiration where it is; null clears it; a date moves
   * it. Extending an expired key is why expiry is a date, not a status.
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
 * `VirtualKeyService` owns the write-path invariants: secret minting/hashing,
 * atomic revision bump + GatewayChangeEvent append, and an audit log entry.
 * RBAC is enforced by tRPC/Hono layers before reaching the service.
 */
export class VirtualKeyService {
  private constructor(
    /** One durable unit of work per mutation: key, change event and audit row together. */
    private readonly transactions: GatewayTransactionPort,
    /** The caps a key's own drawer creates and retires. */
    private readonly keyBudgets: GatewayKeyBudgetRepository,
    /** Which providers a key's scope graph reaches, for allowlist validation. */
    private readonly scopeResolution: GatewayScopeResolutionService,
    private readonly projects: ProjectService,
    private readonly repository: GatewayVirtualKeysPort,
    private readonly changeEvents: GatewayChangeEventsPort,
    private readonly auditLog: GatewayAuditPort,
    private readonly crypto: GatewayVirtualKeyCryptoPort,
    /**
     * The Enterprise governance ledger, when the deployment composes one.
     * Absent means the lifecycle emissions below are not recorded.
     */
    private readonly governanceSignals?: GatewayGovernanceSignalsPort,
  ) {}

  static create(input: {
    transactions: GatewayTransactionPort;
    keyBudgets: GatewayKeyBudgetRepository;
    scopeResolution: GatewayScopeResolutionService;
    projects: ProjectService;
    repository: GatewayVirtualKeysPort;
    changeEvents: GatewayChangeEventsPort;
    auditLog: GatewayAuditPort;
    crypto: GatewayVirtualKeyCryptoPort;
    governanceSignals?: GatewayGovernanceSignalsPort;
  }): VirtualKeyService {
    return new VirtualKeyService(
      input.transactions,
      input.keyBudgets,
      input.scopeResolution,
      input.projects,
      input.repository,
      input.changeEvents,
      input.auditLog,
      input.crypto,
      input.governanceSignals,
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
   * Display names for the keys a page of spend rows names, via
   * `findMetaByIds` (three columns) rather than a raw `findMany`. Fenced by
   * the owning organization so an id list can't leak across tenants.
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
  async tryGetById(id: string, organizationId: string): Promise<VirtualKeyWithScopes | null> {
    const vk = await this.repository.tryFindById({ id, organizationId });
    if (!vk || isProductManaged(vk)) {
      return null;
    }

    return vk;
  }

  /** Used by the `/resolve-key` hot path — do not expose on public tRPC. */
  async tryGetByHashedSecretInternal(hashedSecret: string): Promise<VirtualKeyWithScopes | null> {
    return this.repository.tryFindByHashedSecret(hashedSecret);
  }

  /** Used by internal Gateway transports after their format check succeeds. */
  async tryGetBySecretInternal(secret: string): Promise<VirtualKeyWithScopes | null> {
    return this.tryGetByHashedSecretInternal(this.crypto.hashSecret(secret));
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
      ...input.config,
    });
    const secret = this.crypto.mintSecret();
    const { displayPrefix } = this.crypto.parseSecret(secret);
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

    const created = await this.transactions
      .run(async (tx) => {
        const vk = await this.repository.create(
          {
            id,
            organizationId: input.organizationId,
            name: input.name,
            description: input.description,
            hashedSecret,
            displayPrefix,
            principalUserId: input.principalUserId,
            config,
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

    const updated = await this.transactions
      .run(async (tx) => {
        if (input.scopes) {
          if (input.scopes.length === 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "At least one scope is required",
            });
          }

          await this.repository.replaceScopes(input.id, input.scopes, tx);
        }

        const vk = await this.repository.update(
          {
            id: input.id,
            organizationId: input.organizationId,
            name: input.name ?? existing.name,
            description: input.description ?? existing.description,
            config,
            ...identityPatchData(input),
            ...(input.routingPolicyId !== undefined
              ? { routingPolicyId: input.routingPolicyId }
              : {}),
            ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
            traceProjectId,
            routingMode,
          },
          tx,
        );

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
    const newSecret = this.crypto.mintSecret();
    const { displayPrefix: newDisplayPrefix } = this.crypto.parseSecret(newSecret);
    const newHashedSecret = this.crypto.hashSecret(newSecret);
    const previousSecretValidUntil = new Date(Date.now() + ROTATION_GRACE_MS);

    const rotated = await this.transactions.run(async (tx) => {
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
    if (existing.status === "REVOKED") {
      return existing;
    }

    const before = serialiseForAudit(existing);

    return this.transactions
      .run(async (tx) => {
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
   * Reversible stop. Unlike revoke: budgets and rotation-grace state stay
   * intact and key material never changes, so enable restores service exactly
   * as it was. The distinct DISABLED status must never masquerade as a bad key.
   */
  async disable(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
    reason?: string | null;
  }): Promise<VirtualKeyWithScopes> {
    const existing = await this.requireOwn(input.id, input.organizationId);
    if (existing.status === "DISABLED") {
      return existing;
    }

    if (existing.status === "REVOKED") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A revoked key cannot be disabled; revocation is terminal.",
      });
    }

    const before = serialiseForAudit(existing);

    return this.transactions
      .run(async (tx) => {
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
    if (existing.status === "ACTIVE") {
      return existing;
    }

    if (existing.status === "REVOKED") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A revoked key cannot be enabled; mint a new key instead.",
      });
    }

    const before = serialiseForAudit(existing);

    return this.transactions
      .run(async (tx) => {
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
   * — NOT_FOUND for the same reason `tryGetById` returns null.
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
   * Create or update the budget targeted at this key. Runs inside the caller's
   * transaction so a key and its cap land together or not at all.
   */
  private async upsertKeyBudget(
    args: {
      virtualKey: VirtualKeyWithScopes;
      budget: VirtualKeyBudgetInput;
      actorUserId: string;
    },
    tx: GatewayPersistenceTransaction,
  ): Promise<GatewayBudget> {
    const { virtualKey: vk, budget, actorUserId } = args;
    // The drawer manages exactly one budget row, identified by explicit
    // linkage rather than by shape: matching on target/window would also
    // catch caps created independently on the Budgets page, whose
    // lifecycle (and delete permission) is not the drawer's to touch.
    const existing = await this.keyBudgets.tryFindDrawerManaged(
      { organizationId: vk.organizationId, virtualKeyId: vk.id },
      tx,
    );

    const fields = {
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
      ? await this.keyBudgets.updateForKey(
          {
            id: existing.id,
            fields,
            // Changing the window changes what "this period" means, so the
            // reset instant has to be recomputed with it.
            ...(existing.window !== budget.window
              ? { resetsAt: GatewayWindow.nextResetAt(budget.window) }
              : {}),
          },
          tx,
        )
      : await this.keyBudgets.createForKey(
          {
            organizationId: vk.organizationId,
            virtualKeyId: vk.id,
            createdById: actorUserId,
            resetsAt: GatewayWindow.nextResetAt(budget.window),
            fields,
          },
          tx,
        );

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
   * Archive the budgets a key's lifecycle carries: `drawerManaged` archives
   * only the drawer's own row; `scopedToKey` (REVOKED) archives every budget
   * scoped only to it. Archive, not delete, so ledger rows stay readable.
   */
  private async archiveKeyBudgets({
    vk,
    actorUserId,
    tx,
    include,
  }: {
    vk: VirtualKeyWithScopes;
    actorUserId: string;
    tx: GatewayPersistenceTransaction;
    include: GatewayKeyBudgetScope;
  }): Promise<void> {
    const budgets = await this.keyBudgets.findActiveForKey(
      { organizationId: vk.organizationId, virtualKeyId: vk.id, scope: include },
      tx,
    );
    for (const budget of budgets) {
      const archived = await this.keyBudgets.archive({ id: budget.id, archivedAt: new Date() }, tx);
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
   * Every key must SAY where its traces land (cases:
   * `ProjectService.resolveTraceDestination`). Revocation is not guarded.
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
   * What an update leaves in the destination column. Untouched stays exactly
   * where it is, even when scopes move. Named validates like create; explicit
   * null re-runs the whole decision.
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
   * through its SCOPE graph, not the routing-policy-narrowed dispatch set (the
   * policy blocks at dispatch, not at save).
   */
  private async assertProvidersAllowedReachable(
    vk: VirtualKeyWithScopes,
    providersAllowed: string[] | null,
    tx: GatewayPersistenceTransaction,
  ): Promise<void> {
    if (!providersAllowed) {
      return;
    }

    const reachable = await this.scopeResolution.scopeReachableModelProvidersForVk(vk, tx);
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
    const policy = await this.repository.tryFindRoutingPolicyOwner({ routingPolicyId });
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
 * Reconcile the requested routing mode with the policy reference: one
 * decision expressed in two columns, enforced here rather than trusted
 * from every caller.
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
  if (providersAllowed === undefined || providersAllowed === null) {
    return;
  }

  if (providersAllowed.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "providers_allowed_empty: select at least one provider, or allow all providers",
    });
  }
}

/**
 * A key is never written already expired. Absence leaves the stored date
 * alone and null clears it, so only a real date is checked, against the
 * moment of the write — "now" itself is a refusal.
 */
function assertExpiryInFuture({ expiresAt }: { expiresAt: Date | null | undefined }): void {
  if (!expiresAt) {
    return;
  }

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
      for (const id of a.guardrailIds) {
        set.add(`${a.direction}\u0000${id}`);
      }
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
    if (!beforeSet.has(key)) {
      attached.push(toPair(key));
    }
  }

  for (const key of beforeSet) {
    if (!afterSet.has(key)) {
      detached.push(toPair(key));
    }
  }

  return { attached, detached };
}

function serialiseForAudit(vk: VirtualKeyWithScopes): GatewayAuditJson {
  // Strip secret material. The base serializer already handles BigInt
  // (revision) safely — see auditSerializer.ts.
  const { hashedSecret: _hashedSecret, previousHashedSecret: _previousHashedSecret, ...safe } = vk;

  return serializeRowForAudit(safe as unknown as Record<string, unknown>);
}
