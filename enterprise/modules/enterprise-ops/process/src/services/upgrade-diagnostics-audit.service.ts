// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Cloud admin's reads of the upgrade diagnostics installs sent: every read lands on the audit log. */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type {
  LicensingApi,
  UpgradeDiagnosticsDownload,
  UpgradeDiagnosticsReport,
} from "@langwatch/enterprise-licensing-contract";

type Diagnostics = Pick<LicensingApi, "findUpgradeDiagnostics" | "getUpgradeDiagnosticsDownload">;

export class UpgradeDiagnosticsAuditService {
  static create(deps: {
    diagnostics: Diagnostics;
    auditLog: Pick<AuditLogApi, "record">;
  }): UpgradeDiagnosticsAuditService {
    return new UpgradeDiagnosticsAuditService(deps.diagnostics, deps.auditLog);
  }

  private constructor(
    private readonly diagnostics: Diagnostics,
    private readonly auditLog: Pick<AuditLogApi, "record">,
  ) {}

  async find(input: {
    operatorId: string;
    instanceRowId: string;
  }): Promise<UpgradeDiagnosticsReport[]> {
    await this.auditLog.record({
      userId: input.operatorId,
      action: "selfHostedInstances.findDiagnostics",
      args: { instanceRowId: input.instanceRowId },
      targetKind: "selfHostedInstance",
      targetId: input.instanceRowId,
    });
    return this.diagnostics.findUpgradeDiagnostics({ instanceRowId: input.instanceRowId });
  }

  async getDownload(input: {
    operatorId: string;
    id: string;
  }): Promise<UpgradeDiagnosticsDownload> {
    await this.auditLog.record({
      userId: input.operatorId,
      action: "selfHostedInstances.getDiagnosticsDownload",
      args: { id: input.id },
      targetKind: "upgradeDiagnostics",
      targetId: input.id,
    });
    return this.diagnostics.getUpgradeDiagnosticsDownload({ id: input.id });
  }
}
