// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { GovernanceApi } from "@langwatch/enterprise-governance-contract";

import type { DefaultGovernanceAdminWorkspaceViewAuditService } from "./admin-workspace-view-audit.service.ts";
import type { DefaultGovernanceCliSessionInventoryService } from "./cli-session-inventory.service.ts";
import type { DefaultGovernanceCliTokenRevocationService } from "./cli-token-revocation.service.ts";
import type { DefaultGovernanceCliBootstrapService } from "./governance-cli-tool-bootstrap.service.ts";
import type { DefaultGovernanceSetupStateService } from "./governance-setup-state.service.ts";
import type { QuarantineFillEvaluatorService } from "./quarantine-fill.service.ts";

/** Private cohesive collaborator for the lifecycle operation set. */
export class GovernanceLifecycleOperationsService {
  private readonly cliBootstrap: DefaultGovernanceCliBootstrapService;
  private readonly cliSessions: DefaultGovernanceCliSessionInventoryService;
  private readonly cliTokenRevocation: DefaultGovernanceCliTokenRevocationService;
  private readonly adminWorkspaceViewAudit: DefaultGovernanceAdminWorkspaceViewAuditService;
  private readonly quarantineFill: QuarantineFillEvaluatorService;
  private readonly setupState: DefaultGovernanceSetupStateService;

  private constructor({
    cliBootstrap,
    cliSessions,
    cliTokenRevocation,
    adminWorkspaceViewAudit,
    quarantineFill,
    setupState,
  }: {
    cliBootstrap: DefaultGovernanceCliBootstrapService;
    cliSessions: DefaultGovernanceCliSessionInventoryService;
    cliTokenRevocation: DefaultGovernanceCliTokenRevocationService;
    adminWorkspaceViewAudit: DefaultGovernanceAdminWorkspaceViewAuditService;
    quarantineFill: QuarantineFillEvaluatorService;
    setupState: DefaultGovernanceSetupStateService;
  }) {
    this.cliBootstrap = cliBootstrap;
    this.cliSessions = cliSessions;
    this.cliTokenRevocation = cliTokenRevocation;
    this.adminWorkspaceViewAudit = adminWorkspaceViewAudit;
    this.quarantineFill = quarantineFill;
    this.setupState = setupState;
  }

  static create({
    cliBootstrap,
    cliSessions,
    cliTokenRevocation,
    adminWorkspaceViewAudit,
    quarantineFill,
    setupState,
  }: {
    cliBootstrap: DefaultGovernanceCliBootstrapService;
    cliSessions: DefaultGovernanceCliSessionInventoryService;
    cliTokenRevocation: DefaultGovernanceCliTokenRevocationService;
    adminWorkspaceViewAudit: DefaultGovernanceAdminWorkspaceViewAuditService;
    quarantineFill: QuarantineFillEvaluatorService;
    setupState: DefaultGovernanceSetupStateService;
  }): GovernanceLifecycleOperationsService {
    return new GovernanceLifecycleOperationsService({
      cliBootstrap,
      cliSessions,
      cliTokenRevocation,
      adminWorkspaceViewAudit,
      quarantineFill,
      setupState,
    });
  }

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
