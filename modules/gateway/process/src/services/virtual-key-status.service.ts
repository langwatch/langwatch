/**
 * The reversible and terminal ends of a virtual key's life: revoke, disable and enable. Revocation
 * also retires the caps scoped to the key; disable and enable leave every stored control intact so
 * a paused key resumes exactly as it was.
 */

import type { VirtualKeyWithScopes } from "@langwatch/gateway-contract";
import type { Instant } from "@langwatch/time";
import { TRPCError } from "@trpc/server";

import {
  type GatewayAudit,
  type GatewayChangeEvents,
  type GatewayTransaction,
  type GatewayGovernanceSignals,
} from "../app/gateway.members.ts";
import type { GatewayVirtualKeyRepository } from "../repositories/gateway-virtual-key.repository.ts";
import { VirtualKeyBudgetService } from "./virtual-key-budget.service.ts";
import {
  VirtualKeyValidationService,
  type RevokeVirtualKeyInput,
} from "./virtual-key-validation.service.ts";

export class VirtualKeyStatusService {
  private constructor(
    private readonly transactions: GatewayTransaction,
    private readonly repository: GatewayVirtualKeyRepository,
    private readonly changeEvents: GatewayChangeEvents,
    private readonly auditLog: GatewayAudit,
    private readonly validation: VirtualKeyValidationService,
    private readonly budgets: VirtualKeyBudgetService,
    private readonly governanceSignals?: GatewayGovernanceSignals,
  ) {}

  static create(input: {
    transactions: GatewayTransaction;
    repository: GatewayVirtualKeyRepository;
    changeEvents: GatewayChangeEvents;
    auditLog: GatewayAudit;
    validation: VirtualKeyValidationService;
    budgets: VirtualKeyBudgetService;
    governanceSignals?: GatewayGovernanceSignals;
  }): VirtualKeyStatusService {
    return new VirtualKeyStatusService(
      input.transactions,
      input.repository,
      input.changeEvents,
      input.auditLog,
      input.validation,
      input.budgets,
      input.governanceSignals,
    );
  }

  async revoke(input: RevokeVirtualKeyInput): Promise<VirtualKeyWithScopes> {
    const existing = await this.validation.ownedForMutation(input.id, input.organizationId);
    return this.revokeExisting(existing, input);
  }

  /**
   * A product-managed key, read for the feature that owns it. Customer-facing
   * reads report these keys as absent.
   */
  async findManagedByIdInternal(input: {
    id: string;
    organizationId: string;
  }): Promise<VirtualKeyWithScopes | null> {
    const vk = await this.repository.findById(input);
    return vk && VirtualKeyValidationService.isProductManaged(vk) ? vk : null;
  }

  /**
   * Ends a product-managed key for the feature that owns it; `revoke` refuses
   * one to every customer-facing caller. A key already gone is left alone, so
   * the call is safe to repeat.
   */
  async revokeManagedInternal(input: RevokeVirtualKeyInput): Promise<void> {
    const existing = await this.findManagedByIdInternal({
      id: input.id,
      organizationId: input.organizationId,
    });
    if (!existing) return;
    await this.revokeExisting(existing, input);
  }

  /**
   * Tells every gateway to resolve a product-managed key again, without
   * changing the key. For state the gateway caches that lives outside the key
   * row, such as the install a license is bound to.
   */
  async invalidateManagedInternal(input: { id: string; organizationId: string }): Promise<void> {
    await this.changeEvents.append({
      organizationId: input.organizationId,
      kind: "VK_CONFIG_UPDATED",
      virtualKeyId: input.id,
    });
  }

  /**
   * Replaces the platform services a CONNECT key may serve, and tells every
   * gateway to fetch its bundle again. A key that is not a CONNECT key of the
   * organization is left alone, so the call is safe to repeat after a revoke.
   */
  async setConnectServicesInternal(input: {
    id: string;
    organizationId: string;
    services: readonly string[];
  }): Promise<void> {
    await this.transactions.run(async (tx) => {
      const written = await this.repository.setConnectServices(input, tx);
      if (!written) return;
      await this.changeEvents.append(
        { organizationId: input.organizationId, kind: "VK_CONFIG_UPDATED", virtualKeyId: input.id },
        tx,
      );
    });
  }

  /**
   * Records the license a CONNECT key serves, and tells every gateway to resolve
   * it again. A key that is not a CONNECT key of the organization is left alone.
   */
  async setLicenseFactsInternal(input: {
    id: string;
    organizationId: string;
    tokenHash: string;
    instanceId: string | null;
    expiresAt: Instant | null;
  }): Promise<void> {
    await this.transactions.run(async (tx) => {
      const written = await this.repository.setLicenseFacts(input, tx);
      if (!written) return;
      await this.changeEvents.append(
        { organizationId: input.organizationId, kind: "VK_CONFIG_UPDATED", virtualKeyId: input.id },
        tx,
      );
    });
  }

  private async revokeExisting(
    existing: VirtualKeyWithScopes,
    input: RevokeVirtualKeyInput,
  ): Promise<VirtualKeyWithScopes> {
    if (existing.status === "REVOKED") {
      return existing;
    }

    const before = VirtualKeyValidationService.serialiseForAudit(existing);

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
        await this.budgets.archiveKeyBudgets({
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
            after: VirtualKeyValidationService.serialiseForAudit(vk),
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
    const existing = await this.validation.ownedForMutation(input.id, input.organizationId);
    if (existing.status === "DISABLED") {
      return existing;
    }

    if (existing.status === "REVOKED") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A revoked key cannot be disabled; revocation is terminal.",
      });
    }

    const before = VirtualKeyValidationService.serialiseForAudit(existing);

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
            after: VirtualKeyValidationService.serialiseForAudit(vk),
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
    const existing = await this.validation.ownedForMutation(input.id, input.organizationId);
    if (existing.status === "ACTIVE") {
      return existing;
    }

    if (existing.status === "REVOKED") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A revoked key cannot be enabled; mint a new key instead.",
      });
    }

    const before = VirtualKeyValidationService.serialiseForAudit(existing);

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
            after: VirtualKeyValidationService.serialiseForAudit(vk),
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
}
