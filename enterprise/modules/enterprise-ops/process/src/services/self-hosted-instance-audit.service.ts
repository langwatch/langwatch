// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Cloud admin's registry of self-hosted installs: every read lands on the audit log, as main's did. */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type {
  LicensingApi,
  SelfHostedInstanceDetail,
  SelfHostedInstanceFilters,
  SelfHostedInstancePage,
  SelfHostedInstanceSummary,
} from "@langwatch/enterprise-licensing-contract";

type Instances = Pick<
  LicensingApi,
  "listSelfHostedInstances" | "getSelfHostedInstance" | "summarizeSelfHostedInstances"
>;

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

  async list(
    input: {
      operatorId: string;
      page: number;
      pageSize: number;
      search?: string;
    } & SelfHostedInstanceFilters,
  ): Promise<SelfHostedInstancePage> {
    const { operatorId, ...query } = input;
    await this.auditLog.record({
      userId: operatorId,
      action: "selfHostedInstances.getAll",
      args: {
        page: query.page,
        pageSize: query.pageSize,
        hasSearch: Boolean(query.search),
        sort: query.sort ?? "last_report",
        license: query.license ?? null,
        activity: query.activity ?? null,
        signal: query.signal ?? null,
      },
      targetKind: "selfHostedInstance",
    });
    return this.instances.listSelfHostedInstances(query);
  }

  async summarize(input: { operatorId: string }): Promise<SelfHostedInstanceSummary> {
    await this.auditLog.record({
      userId: input.operatorId,
      action: "selfHostedInstances.summary",
      args: {},
      targetKind: "selfHostedInstance",
    });
    return this.instances.summarizeSelfHostedInstances();
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
