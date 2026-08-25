import { describe, expect, it, vi } from "vitest";
import {
  ProjectService,
  type InternalProject,
  type InternalProjectQuery,
} from "@langwatch/project-contract";
import type {
  GovernanceIngestionSource,
  PullResult,
} from "@langwatch/enterprise-governance-contract";
import { GovernanceEncryptionPort } from "../src/ports/governance-encryption.port";
import {
  GovernanceOcsfEventSinkPort,
  IngestionPullDiagnosticsPort,
  IngestionPullSourcePort,
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

const source: GovernanceIngestionSource = {
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
};

class FakeSources extends IngestionPullSourcePort {
  async tryFindById(): Promise<GovernanceIngestionSource> {
    return source;
  }
}
class FakeProjects extends ProjectService {
  async tryFindInternal(_input: InternalProjectQuery): Promise<InternalProject | null> {
    return null;
  }

  async ensureInternal(_input: InternalProjectQuery): Promise<InternalProject> {
    return {
      id: "gov-project",
      name: "Governance (internal)",
      slug: "governance-org",
      teamId: "team",
      kind: "internal_governance",
      archivedAtMs: null,
      traceSharingEnabled: false,
    };
  }
}
class FakeSink extends GovernanceOcsfEventSinkPort {
  insertEvent = vi.fn(async () => undefined);
}
class FakeEntitlement extends PulledUsageEntitlementPort {
  async isEnabled(): Promise<boolean> {
    return false;
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

function worker(runOnce: () => Promise<PullResult>, deadlineMs = 1_000) {
  const registry = PullerRegistryService.create();
  registry.register({
    id: "test",
    validateConfig: (config) => config,
    runOnce,
  });
  const sink = new FakeSink();
  const service = IngestionPullWorkerService.create({
    sources: new FakeSources(),
    registry,
    credentials: IngestionCredentialsService.create(new IdentityEncryption()),
    projects: new FakeProjects(),
    sink,
    usageEntitlement: new FakeEntitlement(),
    usageRecords: PulledUsageRecordService.create(
      PulledUsagePricingService.create(new FakeRates()),
    ),
    diagnostics: new FakeDiagnostics(),
    configuration: IngestionPullWorkerConfiguration.create({ deadlineMs }),
    now: () => Date.parse("2026-08-24T10:00:00.000Z"),
  });
  return { service, sink };
}

describe("IngestionPullWorkerService", () => {
  it("writes stable OCSF rows and returns the adapter cursor", async () => {
    const { service, sink } = worker(async () => ({
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
    }));

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
  });

  it("cuts off an uncooperative adapter without advancing the cursor", async () => {
    const { service, sink } = worker(() => new Promise<PullResult>(() => undefined), 5);

    await expect(
      service.run({ sourceId: "source-1", cursor: "held" }),
    ).rejects.toBeInstanceOf(IngestionPullDeadlineExceededError);
    expect(sink.insertEvent).not.toHaveBeenCalled();
  });
});
