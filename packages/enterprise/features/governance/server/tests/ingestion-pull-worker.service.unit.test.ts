import { describe, expect, it, vi } from "vitest";
import type {
  InternalProject,
  InternalProjectQuery,
} from "@langwatch/project-contract";
import type {
  GovernanceIngestionSource,
  NormalizedPullEvent,
  PulledUsageObservedEventData,
  PullResult,
} from "@langwatch/enterprise-governance-contract";
import { GovernanceEncryptionPort } from "../src/ports/governance-encryption.port";
import {
  GovernanceOcsfEventSinkPort,
  type GovernanceOcsfEventInput,
  IngestionPullDiagnosticsPort,
  IngestionPullSourcePort,
  PulledUsageDispatcherPort,
  PulledUsageEntitlementPort,
} from "../src/ports/ingestion-pull-worker.port";
import { IngestionCredentialsService } from "../src/services/ingestion-credentials.service";
import {
  IngestionPullDeadlineExceededError,
  IngestionPullWorkerConfiguration,
  IngestionPullWorkerService,
} from "../src/services/ingestion-pull-worker.service";
import { PulledUsagePricingService } from "../src/services/pulled-usage-pricing.service";
import { PulledUsageRecordService } from "../src/services/pulled-usage-record.service";
import { PullerRegistryService } from "../src/services/puller-registry.service";
import { PulledUsageRatePort } from "../src/ports/pulled-usage-rate.port";
import { TestProjectService } from "./support/test-project-service";

function ingestionSource(
  overrides: Partial<GovernanceIngestionSource> = {},
): GovernanceIngestionSource {
  return {
    id: "source-1",
    organizationId: "org-1",
    teamId: null,
    sourceType: "http_custom",
    name: "Custom",
    description: null,
    ingestSecretHash: "hash",
    parserConfig: { adapter: "test", credentials: { token: "plain" } },
    pollerCursor: null,
    errorCount: 0,
    pullSchedule: "* * * * *",
    status: "active",
    lastEventAt: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    createdById: "user-1",
    ...overrides,
  };
}

function pulledUsageEvent(
  overrides: Partial<NormalizedPullEvent> = {},
): NormalizedPullEvent {
  return {
    source_event_id: "usage:2026-08-24:workspace-1",
    event_timestamp: "2026-08-24T09:00:00.000Z",
    actor: "alex@example.com",
    action: "invoke",
    target: "model",
    cost_usd: "0",
    tokens_input: 1,
    tokens_output: 2,
    raw_payload: "{}",
    extra: {
      pulled_usage: {
        costBasis: "computed",
        dimensions: { workspaceId: "workspace-1" },
      },
    },
    ...overrides,
  };
}

class FakeSources extends IngestionPullSourcePort {
  constructor(private readonly source: GovernanceIngestionSource | null) {
    super();
  }

  async tryFindById(): Promise<GovernanceIngestionSource | null> {
    return this.source;
  }
}

class FakeProjects extends TestProjectService {
  tryFindInternal = async (_input: InternalProjectQuery): Promise<InternalProject | null> => null;

  ensureInternal = async (_input: InternalProjectQuery): Promise<InternalProject> => ({
      id: "gov-project",
      name: "Governance (internal)",
      slug: "governance-org",
      teamId: "team",
      kind: "internal_governance",
      archivedAtMs: null,
      traceSharingEnabled: false,
  });
}

class FakeSink extends GovernanceOcsfEventSinkPort {
  insertEvent = vi.fn(async (_input: GovernanceOcsfEventInput) => {});
}
class FakeEntitlement extends PulledUsageEntitlementPort {
  readonly calls = vi.fn();

  constructor(private readonly outcome: boolean | Error = false) {
    super();
  }

  async isEnabled(): Promise<boolean> {
    this.calls();
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }
}

class RecordingPulledUsage extends PulledUsageDispatcherPort {
  readonly records = vi.fn(
    async (
      _input: PulledUsageObservedEventData & {
        tenantId: string;
        occurredAt: number;
      },
    ) => {},
  );

  async recordPulledUsage(
    input: PulledUsageObservedEventData & { tenantId: string; occurredAt: number },
  ): Promise<void> {
    await this.records(input);
  }
}

class FakeDiagnostics extends IngestionPullDiagnosticsPort {
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
  capture = vi.fn();
}

class IdentityEncryption extends GovernanceEncryptionPort {
  encrypt(value: string): string {
    return value;
  }
  decrypt(value: string): string {
    return value;
  }
}

class FakeRates extends PulledUsageRatePort {
  rate(): { costNanoUsd: number; rateVersion: string } {
    return { costNanoUsd: 0, rateVersion: "test" };
  }
}

function worker(input: {
  runOnce: () => Promise<PullResult>;
  deadlineMs?: number;
  source?: GovernanceIngestionSource | null;
  entitlement?: boolean | Error;
}) {
  const registry = PullerRegistryService.create();
  registry.register({
    id: "test",
    validateConfig: (config) => config,
    runOnce: input.runOnce,
  });
  const sink = new FakeSink();
  const entitlement = new FakeEntitlement(input.entitlement);
  const diagnostics = new FakeDiagnostics();
  const service = IngestionPullWorkerService.create({
    sources: new FakeSources(
      input.source === undefined ? ingestionSource() : input.source,
    ),
    registry,
    credentials: IngestionCredentialsService.create(new IdentityEncryption()),
    projects: new FakeProjects(),
    sink,
    usageEntitlement: entitlement,
    usageRecords: PulledUsageRecordService.create(
      PulledUsagePricingService.create(new FakeRates()),
    ),
    diagnostics,
    configuration: IngestionPullWorkerConfiguration.create({
      deadlineMs: input.deadlineMs,
    }),
    now: () => Date.parse("2026-08-24T10:00:00.000Z"),
  });
  return { service, sink, entitlement, diagnostics };
}

describe("IngestionPullWorkerService", () => {
  it("writes stable OCSF rows and returns the adapter cursor", async () => {
    const { service, sink } = worker({
      runOnce: async () => ({
        events: [
          {
            source_event_id: "event-1",
            event_timestamp: "2026-08-24T09:00:00.000Z",
            actor: "alex@example.com",
            action: "invoke",
            target: "model",
            cost_usd: "0",
            tokens_input: 1,
            tokens_output: 2,
            raw_payload: "{}",
          },
        ],
        cursor: "next",
        errorCount: 0,
      }),
    });

    await expect(service.run({ sourceId: "source-1", cursor: null })).resolves.toEqual({
      nextCursor: "next",
      eventCount: 1,
    });
    expect(sink.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "gov-project",
        eventId: "http_custom:source-1:event-1",
        traceId: "pull:http_custom:source-1:event-1",
        actorEmail: "alex@example.com",
      }),
    );

    const [row] = sink.insertEvent.mock.calls[0]!;
    expect(JSON.parse(row.rawOcsfJson)).toMatchObject({
      class_uid: 6003,
      category_uid: 6,
      activity_id: 6,
      metadata: {
        extension: {
          source_type: "http_custom",
          source_id: "source-1",
          raw_event: "{}",
        },
      },
    });
  });

  it("cuts off an uncooperative adapter without advancing the cursor", async () => {
    const { service, sink } = worker({
      runOnce: () => new Promise<PullResult>(() => {}),
      deadlineMs: 5,
    });

    await expect(
      service.run({ sourceId: "source-1", cursor: "held" }),
    ).rejects.toBeInstanceOf(IngestionPullDeadlineExceededError);
    expect(sink.insertEvent).not.toHaveBeenCalled();
  });

  it("keeps the audit path and priced usage on the same durable retry boundary", async () => {
    const { service, sink, entitlement } = worker({
      entitlement: true,
      runOnce: async () => ({
        events: [pulledUsageEvent(), pulledUsageEvent({ source_event_id: "usage:two" })],
        cursor: "next",
        errorCount: 0,
      }),
    });
    const usage = new RecordingPulledUsage();

    await expect(
      service.run({ sourceId: "source-1", cursor: "held", pulledUsage: usage }),
    ).resolves.toEqual({ nextCursor: "next", eventCount: 2 });

    expect(sink.insertEvent).toHaveBeenCalledTimes(2);
    expect(usage.records).toHaveBeenCalledTimes(2);
    expect(entitlement.calls).toHaveBeenCalledTimes(1);

    const [first, second] = usage.records.mock.calls.map(([record]) => record);
    expect(first).toMatchObject({
      tenantId: "gov-project",
      organizationId: "org-1",
      teamId: null,
      projectId: null,
      occurredAt: Date.parse("2026-08-24T09:00:00.000Z"),
    });
    expect(second?.observedAtMs).toBe(first?.observedAtMs);
  });

  it("does not advance past a durable pulled-usage append failure", async () => {
    const { service, sink } = worker({
      entitlement: true,
      runOnce: async () => ({
        events: [pulledUsageEvent()],
        cursor: "next",
        errorCount: 0,
      }),
    });
    const usage = new RecordingPulledUsage();
    usage.records.mockRejectedValueOnce(new Error("event store unavailable"));

    await expect(
      service.run({ sourceId: "source-1", cursor: "held", pulledUsage: usage }),
    ).rejects.toThrow("event store unavailable");
    expect(sink.insertEvent).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the pulled-usage entitlement cannot be resolved", async () => {
    const { service, sink } = worker({
      entitlement: new Error("entitlement unavailable"),
      runOnce: async () => ({
        events: [pulledUsageEvent()],
        cursor: "next",
        errorCount: 0,
      }),
    });
    const usage = new RecordingPulledUsage();

    await expect(
      service.run({ sourceId: "source-1", cursor: "held", pulledUsage: usage }),
    ).rejects.toThrow("entitlement unavailable");
    expect(sink.insertEvent).not.toHaveBeenCalled();
    expect(usage.records).not.toHaveBeenCalled();
  });

  it("keeps an unmappable usage item audit-only without wedging the cursor", async () => {
    const { service, sink, diagnostics } = worker({
      entitlement: true,
      runOnce: async () => ({
        events: [
          pulledUsageEvent({ event_timestamp: "not-a-timestamp" }),
          pulledUsageEvent({ source_event_id: "usage:good" }),
        ],
        cursor: "next",
        errorCount: 0,
      }),
    });
    const usage = new RecordingPulledUsage();

    await expect(
      service.run({ sourceId: "source-1", cursor: "held", pulledUsage: usage }),
    ).resolves.toEqual({ nextCursor: "next", eventCount: 2 });
    expect(sink.insertEvent).toHaveBeenCalledTimes(2);
    expect(usage.records).toHaveBeenCalledTimes(1);
    expect(diagnostics.error).toHaveBeenCalledWith(
      expect.stringContaining("could not map"),
      expect.objectContaining({ sourceEventId: "usage:2026-08-24:workspace-1" }),
    );
  });
});
