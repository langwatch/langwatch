// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GovernanceApi } from "@langwatch/enterprise-governance-contract";
import type { DefaultGovernanceRoutingPolicyService } from "./governance-routing.service.ts";
import type { DefaultGovernancePersonalVirtualKeyService } from "./governance-personal-key.service.ts";
import type { DefaultGovernanceCliBootstrapService } from "./governance-cli-tool-bootstrap.service.ts";
import type { DefaultGovernanceCliSessionInventoryService } from "./cli-session-inventory.service.ts";
import type { DefaultGovernanceCliTokenRevocationService } from "./cli-token-revocation.service.ts";
import type { DefaultGovernanceAdminWorkspaceViewAuditService } from "./admin-workspace-view-audit.service.ts";
import type { QuarantineFillEvaluatorService } from "./quarantine-fill.service.ts";
import type { DefaultGovernanceSetupStateService } from "./governance-setup-state.service.ts";

/** Private cohesive collaborator for the lifecycle operation set. */
export class GovernanceLifecycleOperationsService {
  private constructor(
    private readonly routingPolicies: DefaultGovernanceRoutingPolicyService,
    private readonly personalVirtualKeys: DefaultGovernancePersonalVirtualKeyService,
    private readonly cliBootstrap: DefaultGovernanceCliBootstrapService,
    private readonly cliSessions: DefaultGovernanceCliSessionInventoryService,
    private readonly cliTokenRevocation: DefaultGovernanceCliTokenRevocationService,
    private readonly adminWorkspaceViewAudit: DefaultGovernanceAdminWorkspaceViewAuditService,
    private readonly quarantineFill: QuarantineFillEvaluatorService,
    private readonly setupState: DefaultGovernanceSetupStateService,
  ) {}

  static create(
    routingPolicies: DefaultGovernanceRoutingPolicyService,
    personalVirtualKeys: DefaultGovernancePersonalVirtualKeyService,
    cliBootstrap: DefaultGovernanceCliBootstrapService,
    cliSessions: DefaultGovernanceCliSessionInventoryService,
    cliTokenRevocation: DefaultGovernanceCliTokenRevocationService,
    adminWorkspaceViewAudit: DefaultGovernanceAdminWorkspaceViewAuditService,
    quarantineFill: QuarantineFillEvaluatorService,
    setupState: DefaultGovernanceSetupStateService,
  ): GovernanceLifecycleOperationsService {
    return new GovernanceLifecycleOperationsService(
      routingPolicies,
      personalVirtualKeys,
      cliBootstrap,
      cliSessions,
      cliTokenRevocation,
      adminWorkspaceViewAudit,
      quarantineFill,
      setupState,
    );
  }

  readonly routingPolicyList: GovernanceApi["routingPolicyList"] = (...args) =>
    this.routingPolicies.list(...args);

  readonly tryFindRoutingPolicyById: GovernanceApi["tryFindRoutingPolicyById"] = (...args) =>
    this.routingPolicies.tryFindById(...args);

  readonly routingPolicyGetById: GovernanceApi["routingPolicyGetById"] = (...args) =>
    this.routingPolicies.getById(...args);

  readonly routingPolicyCreate: GovernanceApi["routingPolicyCreate"] = (...args) =>
    this.routingPolicies.create(...args);

  readonly routingPolicyUpdate: GovernanceApi["routingPolicyUpdate"] = (...args) =>
    this.routingPolicies.update(...args);

  readonly routingPolicySetDefault: GovernanceApi["routingPolicySetDefault"] = (...args) =>
    this.routingPolicies.setDefault(...args);

  readonly routingPolicyDelete: GovernanceApi["routingPolicyDelete"] = (...args) =>
    this.routingPolicies.delete(...args);

  readonly tryResolveDefaultRoutingPolicyForUser: GovernanceApi["tryResolveDefaultRoutingPolicyForUser"] =
    (...args) => this.routingPolicies.tryResolveDefaultForUser(...args);

  readonly personalVirtualKeyEnsureDefault: GovernanceApi["personalVirtualKeyEnsureDefault"] = (
    ...args
  ) => this.personalVirtualKeys.ensureDefault(...args);

  readonly personalVirtualKeyIssue: GovernanceApi["personalVirtualKeyIssue"] = (...args) =>
    this.personalVirtualKeys.issue(...args);

  readonly personalVirtualKeyList: GovernanceApi["personalVirtualKeyList"] = (...args) =>
    this.personalVirtualKeys.list(...args);

  readonly personalVirtualKeyRevoke: GovernanceApi["personalVirtualKeyRevoke"] = (...args) =>
    this.personalVirtualKeys.revoke(...args);

  readonly personalVirtualKeyRevokeAllForUser: GovernanceApi["personalVirtualKeyRevokeAllForUser"] =
    (...args) => this.personalVirtualKeys.revokeAllForUser(...args);

  readonly cliBootstrapResolve: GovernanceApi["cliBootstrapResolve"] = (...args) =>
    this.cliBootstrap.resolve(...args);

  readonly cliSessionListForUser: GovernanceApi["cliSessionListForUser"] = (...args) =>
    this.cliSessions.listForUser(...args);

  readonly cliSessionRevoke: GovernanceApi["cliSessionRevoke"] = (...args) =>
    this.cliSessions.revokeSession(...args);

  readonly cliTokenRevokeForUser: GovernanceApi["cliTokenRevokeForUser"] = (...args) =>
    this.cliTokenRevocation.revokeForUser(...args);

  readonly adminWorkspaceRecordView: GovernanceApi["adminWorkspaceRecordView"] = (...args) =>
    this.adminWorkspaceViewAudit.recordView(...args);

  readonly quarantineFillEvaluate: GovernanceApi["quarantineFillEvaluate"] = (...args) =>
    this.quarantineFill.evaluate(...args);

  readonly resolveSetupState: GovernanceApi["resolveSetupState"] = (...args) =>
    this.setupState.resolve(...args);
}
