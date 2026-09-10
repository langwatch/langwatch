import type {
  GovernanceDiagnosticsSink,
  IngestionPullLifecycleChannel,
  IngestionPullTenantResolver,
} from "../app/governance.infrastructure.ts";
import { NullGovernanceDiagnosticsAdapter } from "./governance-diagnostics.service.ts";
import type {
  IngestionPullLifecycleRepository,
  IngestionPullLifecycleSource,
} from "../repositories/ingestion-pull-lifecycle.repository.ts";

export class IngestionPullLifecycleService {
  private constructor(
    private readonly repository: IngestionPullLifecycleRepository,
    private readonly tenant: IngestionPullTenantResolver,
    private readonly commands: IngestionPullLifecycleChannel,
    private readonly diagnostics: GovernanceDiagnosticsSink,
    private readonly now: () => number,
  ) {}

  static create(options: {
    repository: IngestionPullLifecycleRepository;
    tenant: IngestionPullTenantResolver;
    commands: IngestionPullLifecycleChannel;
    diagnostics?: GovernanceDiagnosticsSink;
    now?: () => number;
  }): IngestionPullLifecycleService {
    return new IngestionPullLifecycleService(
      options.repository,
      options.tenant,
      options.commands,
      options.diagnostics ?? new NullGovernanceDiagnosticsAdapter(),
      options.now ?? Date.now,
    );
  }

  async sync(source: IngestionPullLifecycleSource): Promise<void> {
    const tenantId = await this.tenant.resolveTenantId(source.organizationId);
    const occurredAt = this.now();
    const configVersion = `${source.updatedAt.epochMilliseconds}:${source.status}:${source.pullSchedule}:${source.archivedAt?.epochMilliseconds ?? "live"}`;
    const enabled =
      source.pullSchedule !== null &&
      source.archivedAt === null &&
      (source.status === "active" || source.status === "awaiting_first_event");

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

  async reconcile(): Promise<{ reconciled: number; failed: number }> {
    const sources = await this.repository.listForReconciliation();
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
