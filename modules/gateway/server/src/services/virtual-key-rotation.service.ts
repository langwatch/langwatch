/**
 * Secret rotation. A new secret is minted and the previous one keeps working through its grace
 * window, so a caller that has not picked up the new value yet is not cut off mid-deploy. The old
 * hash stays stored only until that window closes.
 */

import { nowInstant } from "@langwatch/time";
import { TRPCError } from "@trpc/server";
import { GatewayAudit } from "../app/gateway.infrastructure.ts";
import { GatewayChangeEvents } from "../app/gateway.infrastructure.ts";
import type { GatewayTransaction } from "../app/gateway.infrastructure.ts";
import { GatewayVirtualKeyCrypto } from "../app/gateway.infrastructure.ts";
import type { GatewayGovernanceSignals } from "../app/gateway.infrastructure.ts";
import type { GatewayVirtualKeys } from "../ports/gateway-virtual-key.port.ts";
import {
  ROTATION_GRACE_MS,
  VirtualKeyValidationService,
  type CreatedVirtualKey,
  type RotateVirtualKeyInput,
} from "./virtual-key-validation.service.ts";

export class VirtualKeyRotationService {
  private constructor(
    private readonly transactions: GatewayTransaction,
    private readonly repository: GatewayVirtualKeys,
    private readonly changeEvents: GatewayChangeEvents,
    private readonly auditLog: GatewayAudit,
    private readonly crypto: GatewayVirtualKeyCrypto,
    private readonly validation: VirtualKeyValidationService,
    private readonly governanceSignals?: GatewayGovernanceSignals,
  ) {}

  static create(input: {
    transactions: GatewayTransaction;
    repository: GatewayVirtualKeys;
    changeEvents: GatewayChangeEvents;
    auditLog: GatewayAudit;
    crypto: GatewayVirtualKeyCrypto;
    validation: VirtualKeyValidationService;
    governanceSignals?: GatewayGovernanceSignals;
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
    const previousSecretValidUntil = nowInstant().add({ milliseconds: ROTATION_GRACE_MS });

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
