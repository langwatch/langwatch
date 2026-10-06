import type {
  GovernanceIngestionSource,
  PullResult,
  PullRunOptions,
} from "@langwatch/enterprise-governance-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import type {
  GovernanceHttpClient,
  GovernanceHttpResponse,
} from "../../channels/governance-http.channel.ts";
import type {
  GovernanceObjectStorageCredentials,
  GovernanceObjectStore,
} from "../../channels/object-store.channel.ts";
import type {
  GovernanceOcsfEventInput,
  GovernanceOcsfEventSink,
} from "../../repositories/governance.repositories.ts";
import type { IngestionPullSourceReader } from "../../repositories/ingestion-source.repository.ts";
import { NO_SUPPRESSION } from "../../rules/erasure-suppression.rules.ts";
import type { PulledUsageRateInput } from "../../rules/pulled-usage-rate.rules.ts";
import { silentIngestionPullDiagnostics } from "../../services/ingestion-pull-log.service.ts";
import type { PulledUsageEntitlements } from "../../services/ingestion-pull-worker.service.ts";
import { IngestionPullWorkerService } from "../../services/ingestion-pull-worker.service.ts";
import { PulledUsagePricingService } from "../../services/pulled-usage-pricing.service.ts";
import { PulledUsageRecordService } from "../../services/pulled-usage-record.service.ts";
import { PullerRegistryService } from "../../services/puller-registry.service.ts";

export class TestHttp implements GovernanceHttpClient {
  constructor(
    private readonly handler: (
      url: string,
      init: Parameters<GovernanceHttpClient["fetch"]>[1],
    ) => Promise<GovernanceHttpResponse>,
  ) {}

  fetch(
    url: string,
    init: Parameters<GovernanceHttpClient["fetch"]>[1],
  ): Promise<GovernanceHttpResponse> {
    return this.handler(url, init);
  }
}

export class FetchHttp implements GovernanceHttpClient {
  async fetch(
    url: string,
    init: Parameters<GovernanceHttpClient["fetch"]>[1],
  ): Promise<GovernanceHttpResponse> {
    const response = await fetch(url, init);
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      json: () => response.json(),
      text: () => response.text(),
    };
  }
}

export class TestObjectStorage implements GovernanceObjectStore {
  objects: { key: string; body: string }[] = [];
  lastList:
    | {
        bucket: string;
        prefix: string;
        region: string;
        endpoint?: string;
        startAfter?: string;
      }
    | undefined;

  async list(input: {
    bucket: string;
    prefix: string;
    region: string;
    endpoint?: string;
    startAfter?: string;
    credentials: GovernanceObjectStorageCredentials;
    signal?: AbortSignal;
    limit: number;
  }): Promise<{ keys: string[]; isTruncated: boolean }> {
    this.lastList = input;
    const matching = this.objects
      .filter(
        (object) =>
          object.key.startsWith(input.prefix) &&
          (input.startAfter === undefined || object.key > input.startAfter),
      )
      .map((object) => object.key);
    return {
      keys: matching.slice(0, input.limit),
      isTruncated: matching.length > input.limit,
    };
  }

  async readText(input: {
    bucket: string;
    key: string;
    region: string;
    endpoint?: string;
    credentials: GovernanceObjectStorageCredentials;
    signal?: AbortSignal;
    maxBytes: number;
  }): Promise<string> {
    const object = this.objects.find((candidate) => candidate.key === input.key);
    if (!object) throw new Error(`stub: missing ${input.key}`);
    return object.body;
  }
}

class TestSource implements IngestionPullSourceReader {
  constructor(private readonly find: () => Promise<GovernanceIngestionSource | null>) {}

  findById(): Promise<GovernanceIngestionSource | null> {
    return this.find();
  }
}

class TestSink implements GovernanceOcsfEventSink {
  constructor(private readonly insert: (input: GovernanceOcsfEventInput) => Promise<void>) {}

  insertEvent(input: GovernanceOcsfEventInput): Promise<void> {
    return this.insert(input);
  }
}

class TestEntitlement implements PulledUsageEntitlements {
  constructor(private readonly enabled: (organizationId: string) => Promise<boolean>) {}

  isEnabled(organizationId: string): Promise<boolean> {
    return this.enabled(organizationId);
  }
}

class TestRate {
  rate(input: PulledUsageRateInput) {
    return {
      costNanoUsd: input.quantities.tokensInput + input.quantities.tokensOutput > 0 ? 1 : 0,
      rateVersion: "test",
    };
  }
}

export type WorkerTestDoubles = {
  source: GovernanceIngestionSource | null;
  adapter: {
    id: string;
    validateConfig(config: unknown): unknown;
    runOnce(options: PullRunOptions, config: unknown): Promise<PullResult>;
  };
  insertEvent: (input: GovernanceOcsfEventInput) => Promise<void>;
  usageEnabled: (organizationId: string) => Promise<boolean>;
  ensureProject: (input: { organizationId: string; kind: string }) => Promise<{ id: string }>;
  discovery?: { recordFromPulledEvents(): Promise<{ discovered: number }> };
  identityMatch?: { runFor(input: { organizationId: string }): Promise<void> };
};

export function createWorkerService(doubles: WorkerTestDoubles): IngestionPullWorkerService {
  const registry = PullerRegistryService.create();
  registry.register(doubles.adapter);
  const pricing = PulledUsagePricingService.create(new TestRate());
  const diagnostics = silentIngestionPullDiagnostics;
  const projects = createApiFixture<ProjectApi>(
    {
      ensureInternal: async (input) => {
        const project = await doubles.ensureProject(input);
        return {
          id: project.id,
          name: "test",
          slug: "test",
          teamId: "test-team",
          kind: "internal_governance",
          archivedAtMs: null,
          traceSharingEnabled: false,
        };
      },
    },
    "ProjectApi",
  );
  return IngestionPullWorkerService.create({
    sources: new TestSource(async () => doubles.source),
    registry,
    projects,
    sink: new TestSink(doubles.insertEvent),
    usageEntitlement: new TestEntitlement(doubles.usageEnabled),
    usageRecords: PulledUsageRecordService.create(pricing),
    suppression: { loadForProvider: async () => NO_SUPPRESSION },
    discovery: doubles.discovery ?? { recordFromPulledEvents: async () => ({ discovered: 0 }) },
    identityMatch: doubles.identityMatch ?? { runFor: async () => undefined },
    unpricedWindows: {
      getUnpricedUsageWindow: async () => ({ since: null, through: null }),
      updateUnpricedUsageWindow: async () => undefined,
    },
    departmentSync: { applyDirectoryEvents: async () => ({ assigned: 0 }) },
    diagnostics,
  });
}
