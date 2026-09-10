/**
 * The virtual-key surface the transports call. Reads answer here; every mutation is delegated to
 * the collaborator that owns its half of the write path, so this stays one place to look up what a
 * caller may ask of a key rather than a second copy of the invariants.
 */

import { type Instant, nowInstant } from "@langwatch/time";
import type { ScopeInput, VirtualKeyWithScopes } from "@langwatch/gateway-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { GatewayAudit } from "../app/gateway.infrastructure.ts";
import { GatewayChangeEvents } from "../app/gateway.infrastructure.ts";
import type { GatewayTransaction } from "../app/gateway.infrastructure.ts";
import type { GatewayKeyBudgetRepository } from "../repositories/gateway-key-budget.repository.ts";
import { GatewayVirtualKeyCrypto } from "../app/gateway.infrastructure.ts";
import type { GatewayVirtualKeys } from "../ports/gateway-virtual-key.port.ts";
import type { GatewayGovernanceSignals } from "../app/gateway.infrastructure.ts";
import type { GatewayScopeResolutionService } from "./gateway-scope-resolution.service.ts";
import { VirtualKeyBudgetService } from "./virtual-key-budget.service.ts";
import { VirtualKeyProvisioningService } from "./virtual-key-provisioning.service.ts";
import { VirtualKeyRotationService } from "./virtual-key-rotation.service.ts";
import { VirtualKeyStatusService } from "./virtual-key-status.service.ts";
import {
  VirtualKeyValidationService,
  type CreatedVirtualKey,
  type CreateVirtualKeyInput,
  type RevokeVirtualKeyInput,
  type RotateVirtualKeyInput,
  type UpdateVirtualKeyInput,
} from "./virtual-key-validation.service.ts";

export class VirtualKeyService {
  private constructor(
    private readonly repository: GatewayVirtualKeys,
    private readonly crypto: GatewayVirtualKeyCrypto,
    private readonly provisioning: VirtualKeyProvisioningService,
    private readonly rotation: VirtualKeyRotationService,
    private readonly status: VirtualKeyStatusService,
  ) {}

  static create(input: {
    transactions: GatewayTransaction;
    keyBudgets: GatewayKeyBudgetRepository;
    scopeResolution: GatewayScopeResolutionService;
    projects: ProjectApi;
    repository: GatewayVirtualKeys;
    changeEvents: GatewayChangeEvents;
    auditLog: GatewayAudit;
    crypto: GatewayVirtualKeyCrypto;
    governanceSignals?: GatewayGovernanceSignals;
  }): VirtualKeyService {
    const validation = VirtualKeyValidationService.create({
      repository: input.repository,
      scopeResolution: input.scopeResolution,
      projects: input.projects,
    });
    const budgets = VirtualKeyBudgetService.create({
      keyBudgets: input.keyBudgets,
      changeEvents: input.changeEvents,
      auditLog: input.auditLog,
    });
    const shared = {
      transactions: input.transactions,
      repository: input.repository,
      changeEvents: input.changeEvents,
      auditLog: input.auditLog,
      validation,
      budgets,
      governanceSignals: input.governanceSignals,
    };

    return new VirtualKeyService(
      input.repository,
      input.crypto,
      VirtualKeyProvisioningService.create({ ...shared, crypto: input.crypto }),
      VirtualKeyRotationService.create({
        transactions: input.transactions,
        repository: input.repository,
        changeEvents: input.changeEvents,
        auditLog: input.auditLog,
        crypto: input.crypto,
        validation,
        governanceSignals: input.governanceSignals,
      }),
      VirtualKeyStatusService.create(shared),
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
    cursor: { createdAt: Instant; id: string } | null;
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
    if (!vk || VirtualKeyValidationService.isProductManaged(vk)) {
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

  /** Mints a key, its scopes and its optional cap in one transaction. */
  async create(input: CreateVirtualKeyInput): Promise<CreatedVirtualKey> {
    return this.provisioning.create(input);
  }

  /** Applies an edit, with every changed control audited. */
  async update(input: UpdateVirtualKeyInput): Promise<VirtualKeyWithScopes> {
    return this.provisioning.update(input);
  }

  /** Mints a new secret, the previous one honoured through its grace window. */
  async rotate(input: RotateVirtualKeyInput): Promise<CreatedVirtualKey> {
    return this.rotation.rotate(input);
  }

  /** Terminal stop: the key dies and its own caps are archived. */
  async revoke(input: RevokeVirtualKeyInput): Promise<VirtualKeyWithScopes> {
    return this.status.revoke(input);
  }

  /** Reversible stop, leaving budgets and key material untouched. */
  async disable(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
    reason?: string | null;
  }): Promise<VirtualKeyWithScopes> {
    return this.status.disable(input);
  }

  /** Reverse of disable: restores ACTIVE without touching anything else. */
  async enable(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<VirtualKeyWithScopes> {
    return this.status.enable(input);
  }

  async touchUsage(id: string): Promise<void> {
    await this.repository.recordUsage(id, nowInstant());
  }
}
