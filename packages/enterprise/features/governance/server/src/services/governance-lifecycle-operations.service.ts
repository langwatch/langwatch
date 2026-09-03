// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type { DefaultGovernanceRoutingPolicyService } from "./governance-routing.service";
import type { DefaultGovernancePersonalVirtualKeyService } from "./governance-personal-key.service";
import type { DefaultGovernanceCliBootstrapService } from "./cli-bootstrap.service";
import type { DefaultGovernanceCliSessionInventoryService } from "./cli-session-inventory.service";
import type { DefaultGovernanceCliTokenRevocationService } from "./cli-token-revocation.service";
import type { DefaultGovernanceAdminWorkspaceViewAuditService } from "./admin-workspace-view-audit.service";
import type { QuarantineFillEvaluatorService } from "./quarantine-fill.service";
import type { DefaultGovernanceSetupStateService } from "./governance-setup-state.service";

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

  readonly routingPolicyList: GovernanceService["routingPolicyList"] = (...args) =>
    this.routingPolicies.list(...args);

  readonly tryFindRoutingPolicyById: GovernanceService["tryFindRoutingPolicyById"] = (...args) =>
    this.routingPolicies.tryFindById(...args);

  readonly routingPolicyGetById: GovernanceService["routingPolicyGetById"] = (...args) =>
    this.routingPolicies.getById(...args);

  readonly routingPolicyCreate: GovernanceService["routingPolicyCreate"] = (...args) =>
    this.routingPolicies.create(...args);

  readonly routingPolicyUpdate: GovernanceService["routingPolicyUpdate"] = (...args) =>
    this.routingPolicies.update(...args);

  readonly routingPolicySetDefault: GovernanceService["routingPolicySetDefault"] = (...args) =>
    this.routingPolicies.setDefault(...args);

  readonly routingPolicyDelete: GovernanceService["routingPolicyDelete"] = (...args) =>
    this.routingPolicies.delete(...args);

  readonly tryResolveDefaultRoutingPolicyForUser: GovernanceService["tryResolveDefaultRoutingPolicyForUser"] =
    (...args) => this.routingPolicies.tryResolveDefaultForUser(...args);

  readonly personalVirtualKeyEnsureDefault: GovernanceService["personalVirtualKeyEnsureDefault"] = (
    ...args
  ) => this.personalVirtualKeys.ensureDefault(...args);

  readonly personalVirtualKeyIssue: GovernanceService["personalVirtualKeyIssue"] = (...args) =>
    this.personalVirtualKeys.issue(...args);

  readonly personalVirtualKeyList: GovernanceService["personalVirtualKeyList"] = (...args) =>
    this.personalVirtualKeys.list(...args);

  readonly personalVirtualKeyRevoke: GovernanceService["personalVirtualKeyRevoke"] = (...args) =>
    this.personalVirtualKeys.revoke(...args);

  readonly personalVirtualKeyRevokeAllForUser: GovernanceService["personalVirtualKeyRevokeAllForUser"] =
    (...args) => this.personalVirtualKeys.revokeAllForUser(...args);

  readonly cliBootstrapResolve: GovernanceService["cliBootstrapResolve"] = (...args) =>
    this.cliBootstrap.resolve(...args);

  readonly cliSessionListForUser: GovernanceService["cliSessionListForUser"] = (...args) =>
    this.cliSessions.listForUser(...args);

  readonly cliSessionRevoke: GovernanceService["cliSessionRevoke"] = (...args) =>
    this.cliSessions.revokeSession(...args);

  readonly cliTokenRevokeForUser: GovernanceService["cliTokenRevokeForUser"] = (...args) =>
    this.cliTokenRevocation.revokeForUser(...args);

  readonly adminWorkspaceRecordView: GovernanceService["adminWorkspaceRecordView"] = (...args) =>
    this.adminWorkspaceViewAudit.recordView(...args);

  readonly quarantineFillEvaluate: GovernanceService["quarantineFillEvaluate"] = (...args) =>
    this.quarantineFill.evaluate(...args);

  readonly resolveSetupState: GovernanceService["resolveSetupState"] = (...args) =>
    this.setupState.resolve(...args);
}
