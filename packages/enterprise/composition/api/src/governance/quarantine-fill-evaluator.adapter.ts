// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import { PROJECT_KIND, type ProjectService } from "@langwatch/project-contract";
import {
  GovernanceDiagnosticsPort,
  QuarantineTenantPort,
  QuarantineTraceActivityPort,
} from "@langwatch/enterprise-governance-server";
import type { AppGovernanceTraceActivityAdapter } from "./governance-trace-activity.clickhouse.repository";

const logger = createLogger("langwatch:governance:quarantine-fill-evaluator");

type QuarantineSpanCountsQuery = {
  tenantId: string;
  sinceMs: number;
};

export class AppQuarantineTenantPort extends QuarantineTenantPort {
  private constructor(private readonly projects: ProjectService) {
    super();
  }

  static create(projects: ProjectService): AppQuarantineTenantPort {
    return new AppQuarantineTenantPort(projects);
  }

  async resolveTenantId(organizationId: string): Promise<string> {
    return (
      await this.projects.ensureInternal({
        organizationId,
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      })
    ).id;
  }
}

export class AppQuarantineTraceActivityPort extends QuarantineTraceActivityPort {
  private constructor(private readonly repository: AppGovernanceTraceActivityAdapter) {
    super();
  }

  static create(repository: AppGovernanceTraceActivityAdapter): AppQuarantineTraceActivityPort {
    return new AppQuarantineTraceActivityPort(repository);
  }

  findSpanCountsBySource(input: QuarantineSpanCountsQuery) {
    return this.repository.findSpanCountsBySource(input);
  }
}

export class AppQuarantineDiagnosticsPort extends GovernanceDiagnosticsPort {
  warn(message: string, context: Record<string, unknown>): void {
    logger.warn(context, message);
  }
}

export class AppQuarantineFillEvaluatorAdapter {
  private constructor(
    private readonly options: {
      projects: ProjectService;
      traceActivity?: AppGovernanceTraceActivityAdapter;
    },
  ) {}

  static create(options: {
    projects: ProjectService;
    traceActivity?: AppGovernanceTraceActivityAdapter;
  }): AppQuarantineFillEvaluatorAdapter {
    return new AppQuarantineFillEvaluatorAdapter(options);
  }

  tenant(): AppQuarantineTenantPort {
    return AppQuarantineTenantPort.create(this.options.projects);
  }

  traceActivity(): AppQuarantineTraceActivityPort | undefined {
    return this.options.traceActivity
      ? AppQuarantineTraceActivityPort.create(this.options.traceActivity)
      : undefined;
  }

  diagnostics(): AppQuarantineDiagnosticsPort {
    return new AppQuarantineDiagnosticsPort();
  }
}
