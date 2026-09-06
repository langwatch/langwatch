/**
 * Secret rotation. A new secret is minted and the previous one keeps working through its grace
 * window, so a caller that has not picked up the new value yet is not cut off mid-deploy. The old
 * hash stays stored only until that window closes.
 */

import { TRPCError } from "@trpc/server";
import { GatewayAuditPort } from "../ports/gateway-audit.port";
import { GatewayChangeEventsPort } from "../ports/gateway-change-events.port";
import type { GatewayTransactionPort } from "../ports/gateway-transaction.port";
import { GatewayVirtualKeyCryptoPort } from "../ports/gateway-virtual-key-crypto.port";
import type { GatewayGovernanceSignalsPort } from "../ports/gateway-governance-signals.port";
import type { GatewayVirtualKeysPort } from "../ports/gateway-virtual-key.port";
import {
  ROTATION_GRACE_MS,
  VirtualKeyValidationService,
  type CreatedVirtualKey,
  type RotateVirtualKeyInput,
} from "./virtual-key-validation.service";

export class VirtualKeyRotationService {
  private constructor(
    private readonly transactions: GatewayTransactionPort,
    private readonly repository: GatewayVirtualKeysPort,
    private readonly changeEvents: GatewayChangeEventsPort,
    private readonly auditLog: GatewayAuditPort,
    private readonly crypto: GatewayVirtualKeyCryptoPort,
    private readonly validation: VirtualKeyValidationService,
    private readonly governanceSignals?: GatewayGovernanceSignalsPort,
  ) {}

  static create(input: {
    transactions: GatewayTransactionPort;
    repository: GatewayVirtualKeysPort;
    changeEvents: GatewayChangeEventsPort;
    auditLog: GatewayAuditPort;
    crypto: GatewayVirtualKeyCryptoPort;
    validation: VirtualKeyValidationService;
    governanceSignals?: GatewayGovernanceSignalsPort;
  }): VirtualKeyRotationService {
    return new VirtualKeyRotationService(
      input.transactions,
      input.repository,
      input.changeEvents,
      input.auditLog,
      input.crypto,
      input.validation,
      input.governanceSignals,
    );
  }

  async rotate(input: RotateVirtualKeyInput): Promise<CreatedVirtualKey> {
    const existing = await this.validation.ownedForMutation(input.id, input.organizationId);
    if (existing.status === "REVOKED") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot rotate a revoked virtual key",
      });
    }

    const before = VirtualKeyValidationService.serialiseForAudit(existing);
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
          after: VirtualKeyValidationService.serialiseForAudit(vk),
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
}
