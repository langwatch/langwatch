import { describe, expect, it, vi } from "vitest";
import { GovernanceDiagnosticsPort } from "../src/ports/governance-diagnostics.port";
import {
  IngestionPullLifecycleCommandPort,
  IngestionPullLifecycleRepository,
  type IngestionPullLifecycleSource,
  IngestionPullTenantPort,
} from "../src/ports/ingestion-pull-lifecycle.port";
import { IngestionPullLifecycleService } from "../src/services/ingestion-pull-lifecycle.service";

const source = (
  overrides: Partial<IngestionPullLifecycleSource> = {},
): IngestionPullLifecycleSource => ({
  id: "source-1",
  organizationId: "org-1",
  status: "active",
  pullSchedule: "*/5 * * * *",
  pollerCursor: { page: 2 },
  updatedAt: new Date(1_000),
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

class FixedTenantPort extends IngestionPullTenantPort {
  async resolveTenantId(organizationId: string): Promise<string> {
    return `project:${organizationId}`;
  }
}

class RecordingCommandPort extends IngestionPullLifecycleCommandPort {
  readonly configure = vi.fn();
  readonly disable = vi.fn();
}

class RecordingDiagnosticsPort extends GovernanceDiagnosticsPort {
  readonly warn = vi.fn();
}

describe("IngestionPullLifecycleService", () => {
  it("configures an active source with a stable version and serialised cursor", async () => {
    const commands = new RecordingCommandPort();
    const service = IngestionPullLifecycleService.create({
      repository: new MemoryLifecycleRepository([]),
      tenant: new FixedTenantPort(),
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
    const commands = new RecordingCommandPort();
    const service = IngestionPullLifecycleService.create({
      repository: new MemoryLifecycleRepository([]),
      tenant: new FixedTenantPort(),
      commands,
      now: () => 2_000,
    });

    await service.sync(source({ archivedAt: new Date(1_500) }));

    expect(commands.disable).toHaveBeenCalledWith({
      tenantId: "project:org-1",
      occurredAt: 2_000,
      sourceId: "source-1",
      configVersion: "1000:active:*/5 * * * *:1500",
    });
    expect(commands.configure).not.toHaveBeenCalled();
  });

  it("continues reconciliation and reports each failed source", async () => {
    const commands = new RecordingCommandPort();
    commands.configure.mockRejectedValueOnce(new Error("pipeline unavailable"));
    const diagnostics = new RecordingDiagnosticsPort();
    const service = IngestionPullLifecycleService.create({
      repository: new MemoryLifecycleRepository([
        source({ id: "source-failed" }),
        source({ id: "source-ok" }),
      ]),
      tenant: new FixedTenantPort(),
      commands,
      diagnostics,
    });

    await expect(service.reconcile()).resolves.toEqual({
      reconciled: 1,
      failed: 1,
    });
    expect(diagnostics.warn).toHaveBeenCalledWith(
      expect.stringContaining("next boot retries"),
      { sourceId: "source-failed", error: "pipeline unavailable" },
    );
  });
});
