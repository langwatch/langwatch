/**
 * Provisioning a virtual key: minting and rotating its secret, and applying an edit. Every mutation
 * writes the key, its change event and its audit rows in one transaction, so a key never exists
 * without the record of who created it or what they changed.
 */

import { randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import type { VirtualKeyConfig, VirtualKeyRoutingMode } from "@langwatch/gateway-contract";
import type { GatewayPersistenceTransaction } from "../ports/gateway-change-events.port.ts";
import {
  defaultVirtualKeyConfig,
  identityPatchData,
  parseVirtualKeyConfig,
  virtualKeyConfigSchema,
  translateExternalIdConflict,
} from "@langwatch/gateway-contract";
import { GatewayAuditPort } from "../ports/gateway-audit.port.ts";
import { GatewayChangeEventsPort } from "../ports/gateway-change-events.port.ts";
import type { GatewayTransactionPort } from "../ports/gateway-transaction.port.ts";
import { GatewayVirtualKeyCryptoPort } from "../ports/gateway-virtual-key-crypto.port.ts";
import type { GatewayGovernanceSignalsPort } from "../ports/gateway-governance-signals.port.ts";
import type {
  GatewayVirtualKeysPort,
  VirtualKeyWithScopes,
} from "../ports/gateway-virtual-key.port.ts";
import { VirtualKeyBudgetService } from "./virtual-key-budget.service.ts";
import {
  VirtualKeyValidationService,
  type CreatedVirtualKey,
  type CreateVirtualKeyInput,
  type UpdateVirtualKeyInput,
} from "./virtual-key-validation.service.ts";

type GuardrailDelta = ReturnType<typeof VirtualKeyValidationService.diffGuardrailAttachments>;

/** What an edit resolves to before the write: the merged config and every derived column. */
interface UpdatePlan {
  before: ReturnType<typeof VirtualKeyValidationService.serialiseForAudit>;
  config: VirtualKeyConfig;
  guardrailDelta: GuardrailDelta;
  routingMode: VirtualKeyRoutingMode;
  traceProjectId: string;
}

export class VirtualKeyProvisioningService {
  private constructor(
    private readonly transactions: GatewayTransactionPort,
    private readonly repository: GatewayVirtualKeysPort,
    private readonly changeEvents: GatewayChangeEventsPort,
    private readonly auditLog: GatewayAuditPort,
    private readonly crypto: GatewayVirtualKeyCryptoPort,
    private readonly validation: VirtualKeyValidationService,
    private readonly budgets: VirtualKeyBudgetService,
    private readonly governanceSignals?: GatewayGovernanceSignalsPort,
  ) {}

  static create(input: {
    transactions: GatewayTransactionPort;
    repository: GatewayVirtualKeysPort;
    changeEvents: GatewayChangeEventsPort;
    auditLog: GatewayAuditPort;
    crypto: GatewayVirtualKeyCryptoPort;
    validation: VirtualKeyValidationService;
    budgets: VirtualKeyBudgetService;
    governanceSignals?: GatewayGovernanceSignalsPort;
  }): VirtualKeyProvisioningService {
    return new VirtualKeyProvisioningService(
      input.transactions,
      input.repository,
      input.changeEvents,
      input.auditLog,
      input.crypto,
      input.validation,
      input.budgets,
      input.governanceSignals,
    );
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
      await this.validation.assertRoutingPolicyBelongsToOrg(
        input.routingPolicyId,
        input.organizationId,
      );
    }

    const routingMode = VirtualKeyValidationService.resolveRoutingMode(
      input.routingMode,
      input.routingPolicyId ?? null,
    );
    VirtualKeyValidationService.assertProvidersAllowedShape(input.config?.providersAllowed);
    VirtualKeyValidationService.assertExpiryInFuture({ expiresAt: input.expiresAt });

    const traceProjectId = await this.validation.resolveStoredTraceDestination({
      organizationId: input.organizationId,
      scopes: input.scopes,
      traceProjectId: input.traceProjectId ?? null,
    });

    const created = await this.transactions
      .run((tx) =>
        this.applyCreate({
          input,
          config,
          hashedSecret,
          displayPrefix,
          routingMode,
          traceProjectId,
          tx,
        }),
      )
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

  /** The write itself: the key row, its optional cap, and the records of its creation. */
  private async applyCreate({
    input,
    config,
    hashedSecret,
    displayPrefix,
    routingMode,
    traceProjectId,
    tx,
  }: {
    input: CreateVirtualKeyInput;
    config: VirtualKeyConfig;
    hashedSecret: string;
    displayPrefix: string;
    routingMode: VirtualKeyRoutingMode;
    traceProjectId: string;
    tx: GatewayPersistenceTransaction;
  }): Promise<VirtualKeyWithScopes> {
    const vk = await this.repository.create(
      {
        id: this.nextVirtualKeyId(),
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
    await this.validation.assertProvidersAllowedReachable(vk, config.providersAllowed, tx);
    if (input.budget) {
      await this.budgets.upsertKeyBudget(
        { virtualKey: vk, budget: input.budget, actorUserId: input.actorUserId },
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
        after: VirtualKeyValidationService.serialiseForAudit(vk),
      },
      tx,
    );

    return vk;
  }

  async update(input: UpdateVirtualKeyInput): Promise<VirtualKeyWithScopes> {
    const existing = await this.validation.ownedForMutation(input.id, input.organizationId);
    if (existing.status === "REVOKED") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot update a revoked virtual key",
      });
    }

    const plan = await this.planUpdate({ input, existing });

    return this.transactions
      .run((tx) => this.applyUpdate({ input, existing, plan, tx }))
      .catch((error: unknown) =>
        translateExternalIdConflict(error, "virtual_key", input.externalId),
      );
  }

  /**
   * What the edit resolves to before anything is written: the merged config, the routing decision
   * expressed across mode and policy reference, the guardrail changes to audit, and where the
   * traces land. Every refusal that does not need the database happens here.
   */
  private async planUpdate({
    input,
    existing,
  }: {
    input: UpdateVirtualKeyInput;
    existing: VirtualKeyWithScopes;
  }): Promise<UpdatePlan> {
    const previousConfig = parseVirtualKeyConfig(existing.config);
    const config = input.config
      ? virtualKeyConfigSchema.parse({ ...previousConfig, ...input.config })
      : previousConfig;
    const guardrailDelta = VirtualKeyValidationService.diffGuardrailAttachments(
      previousConfig.guardrailAttachments,
      config.guardrailAttachments,
    );

    if (input.routingPolicyId) {
      await this.validation.assertRoutingPolicyBelongsToOrg(
        input.routingPolicyId,
        input.organizationId,
      );
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
        ? VirtualKeyValidationService.resolveRoutingMode(
            input.routingMode ?? existing.routingMode,
            nextRoutingPolicyId,
          )
        : existing.routingMode;
    VirtualKeyValidationService.assertProvidersAllowedShape(input.config?.providersAllowed);
    VirtualKeyValidationService.assertExpiryInFuture({ expiresAt: input.expiresAt });

    return {
      before: VirtualKeyValidationService.serialiseForAudit(existing),
      config,
      guardrailDelta,
      routingMode,
      traceProjectId: await this.validation.nextStoredTraceDestination({ existing, input }),
    };
  }

  /** The write itself: scopes, the key row, its cap, and the records of the change. */
  private async applyUpdate({
    input,
    existing,
    plan,
    tx,
  }: {
    input: UpdateVirtualKeyInput;
    existing: VirtualKeyWithScopes;
    plan: UpdatePlan;
    tx: GatewayPersistenceTransaction;
  }): Promise<VirtualKeyWithScopes> {
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
        config: plan.config,
        ...identityPatchData(input),
        ...(input.routingPolicyId !== undefined ? { routingPolicyId: input.routingPolicyId } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
        traceProjectId: plan.traceProjectId,
        routingMode: plan.routingMode,
      },
      tx,
    );

    await this.validation.assertProvidersAllowedReachable(vk, plan.config.providersAllowed, tx);
    await this.applyUpdatedBudget({ input, vk, tx });
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
        before: plan.before,
        after: VirtualKeyValidationService.serialiseForAudit(vk),
      },
      tx,
    );
    await this.auditGuardrailDelta({ input, vk, delta: plan.guardrailDelta, tx });

    return vk;
  }

  /** An absent budget key leaves the cap alone; an explicit null archives the drawer's own row. */
  private async applyUpdatedBudget({
    input,
    vk,
    tx,
  }: {
    input: UpdateVirtualKeyInput;
    vk: VirtualKeyWithScopes;
    tx: GatewayPersistenceTransaction;
  }): Promise<void> {
    if (input.budget === undefined) {
      return;
    }

    if (input.budget) {
      await this.budgets.upsertKeyBudget(
        { virtualKey: vk, budget: input.budget, actorUserId: input.actorUserId },
        tx,
      );

      return;
    }

    await this.budgets.archiveKeyBudgets({
      vk,
      actorUserId: input.actorUserId,
      tx,
      include: "drawerManaged",
    });
  }

  /**
   * Guardrail attach and detach are governance events distinct from a generic config edit, one row
   * per wire change so a SIEM export sees each individually. The target stays the key, the row that
   * opted in, rather than the guardrail.
   */
  private async auditGuardrailDelta({
    input,
    vk,
    delta,
    tx,
  }: {
    input: UpdateVirtualKeyInput;
    vk: VirtualKeyWithScopes;
    delta: GuardrailDelta;
    tx: GatewayPersistenceTransaction;
  }): Promise<void> {
    for (const attached of delta.attached) {
      await this.auditLog.append(
        {
          organizationId: input.organizationId,
          projectId: null,
          actorUserId: input.actorUserId,
          action: "gateway.virtual_key.guardrail_attached",
          targetKind: "virtual_key",
          targetId: vk.id,
          after: { direction: attached.direction, guardrailId: attached.guardrailId },
        },
        tx,
      );
    }

    for (const detached of delta.detached) {
      await this.auditLog.append(
        {
          organizationId: input.organizationId,
          projectId: null,
          actorUserId: input.actorUserId,
          action: "gateway.virtual_key.guardrail_detached",
          targetKind: "virtual_key",
          targetId: vk.id,
          before: { direction: detached.direction, guardrailId: detached.guardrailId },
        },
        tx,
      );
    }
  }

  private nextVirtualKeyId(): string {
    return `vk_${randomBytes(16).toString("base64url")}`;
  }
}
