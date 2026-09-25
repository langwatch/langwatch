// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The backoffice's registry of self-hosted installs: every read lands on the audit log, as main's did. */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type {
  LicensingApi,
  SelfHostedInstanceDetail,
  SelfHostedInstancePage,
} from "@langwatch/enterprise-licensing-contract";

type Instances = Pick<LicensingApi, "listSelfHostedInstances" | "getSelfHostedInstance">;

export class SelfHostedInstanceAuditService {
  static create(deps: {
    instances: Instances;
    auditLog: Pick<AuditLogApi, "record">;
  }): SelfHostedInstanceAuditService {
    return new SelfHostedInstanceAuditService(deps.instances, deps.auditLog);
  }

  private constructor(
    private readonly instances: Instances,
    private readonly auditLog: Pick<AuditLogApi, "record">,
  ) {}

  async list(input: {
    operatorId: string;
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<SelfHostedInstancePage> {
    const { operatorId, ...query } = input;
    await this.auditLog.record({
      userId: operatorId,
      action: "selfHostedInstances.getAll",
      args: { page: query.page, pageSize: query.pageSize, hasSearch: Boolean(query.search) },
      targetKind: "selfHostedInstance",
    });
    return this.instances.listSelfHostedInstances(query);
  }

  async getById(input: { operatorId: string; id: string }): Promise<SelfHostedInstanceDetail> {
    await this.auditLog.record({
      userId: input.operatorId,
      action: "selfHostedInstances.getById",
      args: { id: input.id },
      targetKind: "selfHostedInstance",
      targetId: input.id,
    });
    return this.instances.getSelfHostedInstance({ id: input.id });
  }
}
