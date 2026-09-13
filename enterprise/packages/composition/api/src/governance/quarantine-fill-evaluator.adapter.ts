// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";
import {
  type GovernanceDiagnosticsSink,
  type QuarantineTenantResolver,
  type QuarantineTraceActivityReader,
} from "@langwatch/enterprise-governance-server";
import type { AppGovernanceTraceActivityAdapter } from "./governance-trace-activity.clickhouse.repository.ts";

const logger = createLogger("langwatch:governance:quarantine-fill-evaluator");

type QuarantineSpanCountsQuery = {
  tenantId: string;
  sinceMs: number;
};

export class AppQuarantineTenant implements QuarantineTenantResolver {
  private constructor(private readonly projects: ProjectApi) {}

  static create(projects: ProjectApi): AppQuarantineTenant {
    return new AppQuarantineTenant(projects);
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

export class AppQuarantineTraceActivity implements QuarantineTraceActivityReader {
  private constructor(private readonly repository: AppGovernanceTraceActivityAdapter) {}

  static create(repository: AppGovernanceTraceActivityAdapter): AppQuarantineTraceActivity {
    return new AppQuarantineTraceActivity(repository);
  }

  findSpanCountsBySource(input: QuarantineSpanCountsQuery) {
    return this.repository.findSpanCountsBySource(input);
  }
}

export class AppQuarantineDiagnostics implements GovernanceDiagnosticsSink {
  warn(message: string, context: Record<string, unknown>): void {
    logger.warn(context, message);
  }
}

export class AppQuarantineFillEvaluatorAdapter {
  private constructor(
    private readonly options: {
      projects: ProjectApi;
      traceActivity?: AppGovernanceTraceActivityAdapter;
    },
  ) {}

  static create(options: {
    projects: ProjectApi;
    traceActivity?: AppGovernanceTraceActivityAdapter;
  }): AppQuarantineFillEvaluatorAdapter {
    return new AppQuarantineFillEvaluatorAdapter(options);
  }

  tenant(): AppQuarantineTenant {
    return AppQuarantineTenant.create(this.options.projects);
  }

  traceActivity(): AppQuarantineTraceActivity | undefined {
    return this.options.traceActivity
      ? AppQuarantineTraceActivity.create(this.options.traceActivity)
      : undefined;
  }

  diagnostics(): AppQuarantineDiagnostics {
    return new AppQuarantineDiagnostics();
  }
}
