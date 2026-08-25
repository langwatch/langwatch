// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GovernanceDiagnosticsPort,
  QuarantineFillEvaluatorService,
  QuarantineTenantPort,
  QuarantineTraceActivityPort,
} from "@langwatch/enterprise-governance-server";
import { createLogger } from "@langwatch/observability";
import {
  PROJECT_KIND,
  type ProjectService,
} from "@langwatch/project-contract";
import type { GovernanceTraceActivityClickHouseRepository } from "./governance-trace-activity.clickhouse.repository";

const logger = createLogger("langwatch:governance:quarantine-fill-evaluator");

class AppQuarantineTenantPort extends QuarantineTenantPort {
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

class AppQuarantineTraceActivityPort extends QuarantineTraceActivityPort {
  private constructor(
    private readonly repository: GovernanceTraceActivityClickHouseRepository,
  ) {
    super();
  }

  static create(
    repository: GovernanceTraceActivityClickHouseRepository,
  ): AppQuarantineTraceActivityPort {
    return new AppQuarantineTraceActivityPort(repository);
  }

  findSpanCountsBySource(
    input: Parameters<QuarantineTraceActivityPort["findSpanCountsBySource"]>[0],
  ) {
    return this.repository.findSpanCountsBySource(input);
  }
}

class AppQuarantineDiagnosticsPort extends GovernanceDiagnosticsPort {
  warn(message: string, context: Record<string, unknown>): void {
    logger.warn(context, message);
  }
}

export class AppQuarantineFillEvaluatorAdapter {
  private constructor(
    private readonly options: {
      projects: ProjectService;
      traceActivity?: GovernanceTraceActivityClickHouseRepository;
    },
  ) {}

  static create(options: {
    projects: ProjectService;
    traceActivity?: GovernanceTraceActivityClickHouseRepository;
  }): AppQuarantineFillEvaluatorAdapter {
    return new AppQuarantineFillEvaluatorAdapter(options);
  }

  build(): QuarantineFillEvaluatorService {
    return QuarantineFillEvaluatorService.create({
      tenant: AppQuarantineTenantPort.create(this.options.projects),
      traceActivity: this.options.traceActivity
        ? AppQuarantineTraceActivityPort.create(this.options.traceActivity)
        : undefined,
      diagnostics: new AppQuarantineDiagnosticsPort(),
    });
  }
}
