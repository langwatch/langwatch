import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";

import type {
  GovernanceDiagnosticsSink,
  IngestionPullLifecycleChannel,
  IngestionPullTenantResolver,
} from "../app/governance.members.ts";
import type {
  IngestionPullLifecycleRepository,
  IngestionPullLifecycleSource,
} from "../repositories/ingestion-pull-lifecycle.repository.ts";
import { schedulerWillPull } from "../rules/pull-schedule.rules.ts";
import { NullGovernanceDiagnosticsAdapter } from "./governance-diagnostics.service.ts";

export class IngestionPullLifecycleService {
  private readonly repository: IngestionPullLifecycleRepository;
  private readonly projects: Pick<ProjectApi, "findInternalIds">;
  private readonly tenant: IngestionPullTenantResolver;
  private readonly commands: IngestionPullLifecycleChannel;
  private readonly diagnostics: GovernanceDiagnosticsSink;
  private readonly now: () => number;

  private constructor({
    repository,
    projects,
    tenant,
    commands,
    diagnostics,
    now,
  }: {
    repository: IngestionPullLifecycleRepository;
    projects: Pick<ProjectApi, "findInternalIds">;
    tenant: IngestionPullTenantResolver;
    commands: IngestionPullLifecycleChannel;
    diagnostics: GovernanceDiagnosticsSink;
    now: () => number;
  }) {
    this.repository = repository;
    this.projects = projects;
    this.tenant = tenant;
    this.commands = commands;
    this.diagnostics = diagnostics;
    this.now = now;
  }

  static create(options: {
    repository: IngestionPullLifecycleRepository;
    projects: Pick<ProjectApi, "findInternalIds">;
    tenant: IngestionPullTenantResolver;
    commands: IngestionPullLifecycleChannel;
    diagnostics?: GovernanceDiagnosticsSink;
    now?: () => number;
  }): IngestionPullLifecycleService {
    return new IngestionPullLifecycleService({
      repository: options.repository,
      projects: options.projects,
      tenant: options.tenant,
      commands: options.commands,
      diagnostics: options.diagnostics ?? new NullGovernanceDiagnosticsAdapter(),
      now: options.now ?? Date.now,
    });
  }

  async sync(source: IngestionPullLifecycleSource): Promise<void> {
    const tenantId = await this.tenant.resolveTenantId(source.organizationId);
    const occurredAt = this.now();
    const configVersion = `${source.updatedAt.epochMilliseconds}:${source.status}:${source.pullSchedule}:${source.archivedAt?.epochMilliseconds ?? "live"}`;
    const enabled = schedulerWillPull(source);

    if (enabled && source.pullSchedule) {
      await this.commands.configure({
        tenantId,
        occurredAt,
        sourceId: source.id,
        cron: source.pullSchedule,
        configVersion,
        cursor: this.tryCursorOf(source.pollerCursor),
      });

      return;
    }

    await this.commands.disable({
      tenantId,
      occurredAt,
      sourceId: source.id,
      configVersion,
    });
  }

  async reconcile({
    findPullProcessKeys,
  }: {
    findPullProcessKeys: (input: { projectIds: string[] }) => Promise<string[]>;
  }): Promise<{ reconciled: number; failed: number }> {
    const projectIds = await this.projects.findInternalIds({
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
    });
    const processKeys = projectIds.length === 0 ? [] : await findPullProcessKeys({ projectIds });
    const sources = await this.repository.findForReconciliation({ processKeys });
    let reconciled = 0;
    let failed = 0;

    for (const source of sources) {
      try {
        await this.sync(source);
        reconciled += 1;
      } catch (error) {
        failed += 1;
        this.diagnostics.warn(
          "Reconciling this ingestion source's pull process failed; the next boot retries it",
          {
            sourceId: source.id,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    return { reconciled, failed };
  }

  private tryCursorOf(cursor: unknown): string | null {
    if (typeof cursor === "string") {
      return cursor;
    }

    return cursor == null ? null : JSON.stringify(cursor);
  }
}
