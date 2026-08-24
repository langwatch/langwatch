// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GovernanceDiagnosticsPort,
  IngestionPullLifecycleCommandPort,
  IngestionPullTenantPort,
  PostgresIngestionPullLifecycleAdapter,
  type IngestionPullLifecycleService,
  type IngestionPullLifecycleSource,
} from "@langwatch/enterprise-governance-server";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { ensureHiddenGovernanceProject } from "../governanceProject.service";

const logger = createLogger("langwatch:governance:ingestion-pull-lifecycle");

export type AppIngestionPullLifecycleCommands = {
  configure(
    input: Parameters<IngestionPullLifecycleCommandPort["configure"]>[0],
  ): Promise<unknown>;
  disable(
    input: Parameters<IngestionPullLifecycleCommandPort["disable"]>[0],
  ): Promise<unknown>;
};

class AppIngestionPullTenantPort extends IngestionPullTenantPort {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(prisma: PrismaClient): AppIngestionPullTenantPort {
    return new AppIngestionPullTenantPort(prisma);
  }

  async resolveTenantId(organizationId: string): Promise<string> {
    const project = await ensureHiddenGovernanceProject(
      this.prisma,
      organizationId,
    );
    return project.id;
  }
}

class AppIngestionPullCommandPort extends IngestionPullLifecycleCommandPort {
  private constructor(
    private readonly commands: AppIngestionPullLifecycleCommands,
  ) {
    super();
  }

  static create(
    commands: AppIngestionPullLifecycleCommands,
  ): AppIngestionPullCommandPort {
    return new AppIngestionPullCommandPort(commands);
  }

  async configure(
    input: Parameters<IngestionPullLifecycleCommandPort["configure"]>[0],
  ): Promise<void> {
    await this.commands.configure(input);
  }

  async disable(
    input: Parameters<IngestionPullLifecycleCommandPort["disable"]>[0],
  ): Promise<void> {
    await this.commands.disable(input);
  }
}

class AppIngestionPullDiagnosticsPort extends GovernanceDiagnosticsPort {
  warn(message: string, context: Record<string, unknown>): void {
    logger.warn(context, message);
  }
}

export class AppIngestionPullLifecycleService {
  private constructor(private readonly service: IngestionPullLifecycleService) {}

  static create(options: {
    prisma: PrismaClient;
    commands: AppIngestionPullLifecycleCommands;
  }): AppIngestionPullLifecycleService {
    return new AppIngestionPullLifecycleService(
      PostgresIngestionPullLifecycleAdapter.create({
        database: options.prisma,
        tenant: AppIngestionPullTenantPort.create(options.prisma),
        commands: AppIngestionPullCommandPort.create(options.commands),
        diagnostics: new AppIngestionPullDiagnosticsPort(),
      }).build(),
    );
  }

  sync(source: IngestionPullLifecycleSource): Promise<void> {
    return this.service.sync(source);
  }

  reconcile(): Promise<{ reconciled: number; failed: number }> {
    return this.service.reconcile();
  }
}
