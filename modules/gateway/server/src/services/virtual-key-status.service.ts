/**
 * The reversible and terminal ends of a virtual key's life: revoke, disable and enable. Revocation
 * also retires the caps scoped to the key; disable and enable leave every stored control intact so
 * a paused key resumes exactly as it was.
 */

import { TRPCError } from "@trpc/server";
import type { VirtualKeyWithScopes } from "@langwatch/gateway-contract";
import { GatewayAuditPort } from "../ports/gateway-audit.port.ts";
import { GatewayChangeEventsPort } from "../ports/gateway-change-events.port.ts";
import type { GatewayTransactionPort } from "../ports/gateway-transaction.port.ts";
import type { GatewayGovernanceSignalsPort } from "../ports/gateway-governance-signals.port.ts";
import type { GatewayVirtualKeysPort } from "../ports/gateway-virtual-key.port.ts";
import { VirtualKeyBudgetService } from "./virtual-key-budget.service.ts";
import {
  VirtualKeyValidationService,
  type RevokeVirtualKeyInput,
} from "./virtual-key-validation.service.ts";

export class VirtualKeyStatusService {
  private constructor(
    private readonly transactions: GatewayTransactionPort,
    private readonly repository: GatewayVirtualKeysPort,
    private readonly changeEvents: GatewayChangeEventsPort,
    private readonly auditLog: GatewayAuditPort,
    private readonly validation: VirtualKeyValidationService,
    private readonly budgets: VirtualKeyBudgetService,
    private readonly governanceSignals?: GatewayGovernanceSignalsPort,
  ) {}

  static create(input: {
    transactions: GatewayTransactionPort;
    repository: GatewayVirtualKeysPort;
    changeEvents: GatewayChangeEventsPort;
    auditLog: GatewayAuditPort;
    validation: VirtualKeyValidationService;
    budgets: VirtualKeyBudgetService;
    governanceSignals?: GatewayGovernanceSignalsPort;
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
