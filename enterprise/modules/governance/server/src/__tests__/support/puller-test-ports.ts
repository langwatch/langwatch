import type {
  GovernanceIngestionSource,
  PullResult,
  PullRunOptions,
} from "@langwatch/enterprise-governance-contract";
import {
  GovernanceHttpClient,
  GovernanceObjectStore,
  GovernanceOcsfEventSink,
  type GovernanceEncryptor,
  IngestionCredentialsService,
  IngestionPullSourceReader,
  IngestionPullWorkerService,
  NullIngestionPullDiagnosticsAdapter,
  PulledUsageEntitlements,
  PulledUsagePricingService,
  PulledUsageRecordService,
  type GovernanceHttpResponse,
  type GovernanceObjectStorageCredentials,
  type GovernanceOcsfEventInput,
} from "@langwatch/enterprise-governance-server";
import type { PulledUsageRateInput } from "../../app/governance.infrastructure.ts";
import { PullerRegistryService } from "../../services/puller-registry.service.ts";
import { TestProjectApi as CompleteTestProjectService } from "./test-project-api.ts";

export class TestHttp implements GovernanceHttpClient {
  constructor(
    private readonly handler: (
      url: string,
      init: Parameters<GovernanceHttpClient["fetch"]>[1],
    ) => Promise<GovernanceHttpResponse>,
  ) {
  }

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
      json: () => response.json(),
      text: () => response.text(),
    };
  }
}

export class TestObjectStorage implements GovernanceObjectStore {
  objects: Array<{ key: string; body: string }> = [];
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
  }): Promise<string[]> {
    this.lastList = input;
    return this.objects
      .filter(
        (object) =>
          object.key.startsWith(input.prefix) &&
          (input.startAfter === undefined || object.key > input.startAfter),
      )
      .slice(0, input.limit)
      .map((object) => object.key);
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

class TestSource extends IngestionPullSourceReader {
  constructor(private readonly find: () => Promise<GovernanceIngestionSource | null>) {
    super();
  }

  findById(): Promise<GovernanceIngestionSource | null> {
    return this.find();
  }
}

class TestSink extends GovernanceOcsfEventSink {
  constructor(private readonly insert: (input: GovernanceOcsfEventInput) => Promise<void>) {
    super();
  }

  insertEvent(input: GovernanceOcsfEventInput): Promise<void> {
    return this.insert(input);
  }
}

class TestEntitlement extends PulledUsageEntitlements {
  constructor(private readonly enabled: (organizationId: string) => Promise<boolean>) {
    super();
  }

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
  ensureProject: () => Promise<{ id: string }>;
};

export function createWorkerService(doubles: WorkerTestDoubles): IngestionPullWorkerService {
  const registry = PullerRegistryService.create();
  registry.register(doubles.adapter);
  const pricing = PulledUsagePricingService.create(new TestRate());
  const diagnostics = new NullIngestionPullDiagnosticsAdapter();
  const projects = new CompleteTestProjectService();
  projects.ensureInternal = async () => {
    const project = await doubles.ensureProject();
    return {
      id: project.id,
      name: "test",
      slug: "test",
      teamId: "test-team",
      kind: "internal_governance",
      archivedAtMs: null,
      traceSharingEnabled: false,
    };
  };
  const encryption: GovernanceEncryptor = {
    encrypt(value: string): string {
      return value;
    },
    decrypt(value: string): string {
      return value;
    },
  };
  return IngestionPullWorkerService.create({
    sources: new TestSource(async () => doubles.source),
    registry,
    credentials: IngestionCredentialsService.create(encryption),
    projects,
    sink: new TestSink(doubles.insertEvent),
    usageEntitlement: new TestEntitlement(doubles.usageEnabled),
    usageRecords: PulledUsageRecordService.create(pricing),
    diagnostics,
  });
}
