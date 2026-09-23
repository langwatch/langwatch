/**
 * Secret rotation. A new secret is minted and the previous one keeps working through its grace
 * window, so a caller that has not picked up the new value yet is not cut off mid-deploy. The old
 * hash stays stored only until that window closes.
 */

import { nowInstant } from "@langwatch/time";
import { TRPCError } from "@trpc/server";

import {
  type GatewayAudit,
  type GatewayChangeEvents,
  type GatewayTransaction,
  type GatewayVirtualKeyCrypto,
  type GatewayGovernanceSignals,
} from "../app/gateway.members.ts";
import type { GatewayVirtualKeyRepository } from "../repositories/gateway-virtual-key.repository.ts";
import {
  ROTATION_GRACE_MS,
  VirtualKeyValidationService,
  type CreatedVirtualKey,
  type RotateVirtualKeyInput,
} from "./virtual-key-validation.service.ts";

export class VirtualKeyRotationService {
  private readonly transactions: GatewayTransaction;
  private readonly repository: GatewayVirtualKeyRepository;
  private readonly changeEvents: GatewayChangeEvents;
  private readonly auditLog: GatewayAudit;
  private readonly crypto: GatewayVirtualKeyCrypto;
  private readonly validation: VirtualKeyValidationService;
  private readonly governanceSignals?: GatewayGovernanceSignals;

  private constructor({
    transactions,
    repository,
    changeEvents,
    auditLog,
    crypto,
    validation,
    governanceSignals,
  }: {
    transactions: GatewayTransaction;
    repository: GatewayVirtualKeyRepository;
    changeEvents: GatewayChangeEvents;
    auditLog: GatewayAudit;
    crypto: GatewayVirtualKeyCrypto;
    validation: VirtualKeyValidationService;
    governanceSignals?: GatewayGovernanceSignals;
  }) {
    this.transactions = transactions;
    this.repository = repository;
    this.changeEvents = changeEvents;
    this.auditLog = auditLog;
    this.crypto = crypto;
    this.validation = validation;
    this.governanceSignals = governanceSignals;
  }

  static create(input: {
    transactions: GatewayTransaction;
    repository: GatewayVirtualKeyRepository;
    changeEvents: GatewayChangeEvents;
    auditLog: GatewayAudit;
    crypto: GatewayVirtualKeyCrypto;
    validation: VirtualKeyValidationService;
    governanceSignals?: GatewayGovernanceSignals;
  }): VirtualKeyRotationService {
    return new VirtualKeyRotationService({
      transactions: input.transactions,
      repository: input.repository,
      changeEvents: input.changeEvents,
      auditLog: input.auditLog,
      crypto: input.crypto,
      validation: input.validation,
      governanceSignals: input.governanceSignals,
    });
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
