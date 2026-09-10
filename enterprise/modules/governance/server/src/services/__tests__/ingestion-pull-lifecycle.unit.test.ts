import { describe, expect, it, vi } from "vitest";
import type { GovernanceDiagnosticsSink } from "../../app/governance.infrastructure.ts";
import type {
  IngestionPullLifecycleChannel,
  IngestionPullTenantResolver,
} from "../../app/governance.infrastructure.ts";
import {
  IngestionPullLifecycleRepository,
  type IngestionPullLifecycleSource,
} from "../../repositories/ingestion-pull-lifecycle.repository.ts";
import { IngestionPullLifecycleService } from "../ingestion-pull-lifecycle.service.ts";
import { Temporal } from "@langwatch/time";

const source = (
  overrides: Partial<IngestionPullLifecycleSource> = {},
): IngestionPullLifecycleSource => ({
  id: "source-1",
  organizationId: "org-1",
  status: "active",
  pullSchedule: "*/5 * * * *",
  pollerCursor: { page: 2 },
  updatedAt: Temporal.Instant.fromEpochMilliseconds(1_000),
  archivedAt: null,
  ...overrides,
});

class MemoryLifecycleRepository extends IngestionPullLifecycleRepository {
  constructor(private readonly sources: IngestionPullLifecycleSource[]) {
    super();
  }

  async listForReconciliation(): Promise<IngestionPullLifecycleSource[]> {
    return this.sources;
  }
}

class FixedTenant implements IngestionPullTenantResolver {
  async resolveTenantId(organizationId: string): Promise<string> {
    return `project:${organizationId}`;
  }
}

class RecordingCommand implements IngestionPullLifecycleChannel {
  readonly configure = vi.fn();
  readonly disable = vi.fn();
}

class RecordingDiagnostics implements GovernanceDiagnosticsSink {
  readonly warn = vi.fn();
}

describe("IngestionPullLifecycleService", () => {
  it("configures an active source with a stable version and serialised cursor", async () => {
    const commands = new RecordingCommand();
    const service = IngestionPullLifecycleService.create({
      repository: new MemoryLifecycleRepository([]),
      tenant: new FixedTenant(),
      commands,
      now: () => 2_000,
    });

    await service.sync(source());

    expect(commands.configure).toHaveBeenCalledWith({
      tenantId: "project:org-1",
      occurredAt: 2_000,
      sourceId: "source-1",
      cron: "*/5 * * * *",
      configVersion: "1000:active:*/5 * * * *:live",
      cursor: '{"page":2}',
    });
    expect(commands.disable).not.toHaveBeenCalled();
  });

  it("disables an archived source", async () => {
    const commands = new RecordingCommand();
    const service = IngestionPullLifecycleService.create({
      repository: new MemoryLifecycleRepository([]),
      tenant: new FixedTenant(),
      commands,
      now: () => 2_000,
    });

    await service.sync(source({ archivedAt: Temporal.Instant.fromEpochMilliseconds(1_500) }));

    expect(commands.disable).toHaveBeenCalledWith({
      tenantId: "project:org-1",
      occurredAt: 2_000,
      sourceId: "source-1",
      configVersion: "1000:active:*/5 * * * *:1500",
    });
    expect(commands.configure).not.toHaveBeenCalled();
  });

  it("continues reconciliation and reports each failed source", async () => {
    const commands = new RecordingCommand();
    commands.configure.mockRejectedValueOnce(new Error("pipeline unavailable"));
    const diagnostics = new RecordingDiagnostics();
    const service = IngestionPullLifecycleService.create({
      repository: new MemoryLifecycleRepository([
        source({ id: "source-failed" }),
        source({ id: "source-ok" }),
      ]),
      tenant: new FixedTenant(),
      commands,
      diagnostics,
    });

    await expect(service.reconcile()).resolves.toEqual({
      reconciled: 1,
      failed: 1,
    });
    expect(diagnostics.warn).toHaveBeenCalledWith(expect.stringContaining("next boot retries"), {
      sourceId: "source-failed",
      error: "pipeline unavailable",
    });
  });
});
