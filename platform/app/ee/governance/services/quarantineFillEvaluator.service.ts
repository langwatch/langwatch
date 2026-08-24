// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GovernanceDiagnosticsPort,
  QuarantineFillEvaluatorService,
  QuarantineTenantPort,
  QuarantineTraceActivityPort,
  type QuarantineFillInput,
  type QuarantineFillStats,
} from "@langwatch/enterprise-governance-server";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { ensureHiddenGovernanceProject } from "./governanceProject.service";
import type { GovernanceTraceActivityClickHouseRepository } from "./governanceTraceActivity.clickhouse.repository";

const logger = createLogger("langwatch:governance:quarantine-fill-evaluator");

class AppQuarantineTenantPort extends QuarantineTenantPort {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(prisma: PrismaClient): AppQuarantineTenantPort {
    return new AppQuarantineTenantPort(prisma);
  }

  async resolveTenantId(organizationId: string): Promise<string> {
    return (await ensureHiddenGovernanceProject(this.prisma, organizationId))
      .id;
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

export class AppQuarantineFillEvaluatorService {
  private constructor(private readonly service: QuarantineFillEvaluatorService) {}

  static create(options: {
    prisma: PrismaClient;
    traceActivity?: GovernanceTraceActivityClickHouseRepository;
  }): AppQuarantineFillEvaluatorService {
    return new AppQuarantineFillEvaluatorService(
      QuarantineFillEvaluatorService.create({
        tenant: AppQuarantineTenantPort.create(options.prisma),
        traceActivity: options.traceActivity
          ? AppQuarantineTraceActivityPort.create(options.traceActivity)
          : undefined,
        diagnostics: new AppQuarantineDiagnosticsPort(),
      }),
    );
  }

  evaluate(input: QuarantineFillInput): Promise<QuarantineFillStats> {
    return this.service.evaluate(input);
  }
}
