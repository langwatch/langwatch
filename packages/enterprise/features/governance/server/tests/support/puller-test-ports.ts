import type {
  GovernanceIngestionSource,
  PullResult,
  PullRunOptions,
} from "@langwatch/enterprise-governance-contract";
import {
  GovernanceHttpPort,
  GovernanceObjectStoragePort,
  GovernanceOcsfEventSinkPort,
  GovernanceEncryptionPort,
  IngestionPullDiagnosticsPort,
  IngestionCredentialsService,
  IngestionPullSourcePort,
  IngestionPullWorkerService,
  NullIngestionPullDiagnosticsPort,
  PulledUsageEntitlementPort,
  PulledUsagePricingService,
  PulledUsageRecordService,
  type GovernanceHttpResponse,
  type GovernanceObjectStorageCredentials,
  type GovernanceOcsfEventInput,
} from "@langwatch/enterprise-governance-server";
import type { PulledUsageRateInput } from "../../src/ports/pulled-usage-rate.port";
import { PullerRegistryService } from "../../src/services/puller-registry.service";
import { TestProjectService as CompleteTestProjectService } from "./test-project-service";

export class TestHttpPort extends GovernanceHttpPort {
  constructor(
    private readonly handler: (
      url: string,
      init: Parameters<GovernanceHttpPort["fetch"]>[1],
    ) => Promise<GovernanceHttpResponse>,
  ) {
    super();
  }

  fetch(
    url: string,
    init: Parameters<GovernanceHttpPort["fetch"]>[1],
  ): Promise<GovernanceHttpResponse> {
    return this.handler(url, init);
  }
}

export class FetchHttpPort extends GovernanceHttpPort {
  async fetch(
    url: string,
    init: Parameters<GovernanceHttpPort["fetch"]>[1],
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

export class TestObjectStoragePort extends GovernanceObjectStoragePort {
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

class TestSourcePort extends IngestionPullSourcePort {
  constructor(private readonly find: () => Promise<GovernanceIngestionSource | null>) {
    super();
  }

  tryFindById(): Promise<GovernanceIngestionSource | null> {
    return this.find();
  }
}

class TestSinkPort extends GovernanceOcsfEventSinkPort {
  constructor(private readonly insert: (input: GovernanceOcsfEventInput) => Promise<void>) {
    super();
  }

  insertEvent(input: GovernanceOcsfEventInput): Promise<void> {
    return this.insert(input);
  }
}

class TestEntitlementPort extends PulledUsageEntitlementPort {
  constructor(private readonly enabled: (organizationId: string) => Promise<boolean>) {
    super();
  }

  isEnabled(organizationId: string): Promise<boolean> {
    return this.enabled(organizationId);
  }
}

class TestRatePort {
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
  const pricing = PulledUsagePricingService.create(new TestRatePort());
  const diagnostics = new NullIngestionPullDiagnosticsPort();
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
  const encryption = new (class extends GovernanceEncryptionPort {
    encrypt(value: string): string {
      return value;
    }

    decrypt(value: string): string {
      return value;
    }
  })();
  return IngestionPullWorkerService.create({
    sources: new TestSourcePort(async () => doubles.source),
    registry,
    credentials: IngestionCredentialsService.create(encryption),
    projects,
    sink: new TestSinkPort(doubles.insertEvent),
    usageEntitlement: new TestEntitlementPort(doubles.usageEnabled),
    usageRecords: PulledUsageRecordService.create(pricing),
    diagnostics,
  });
}
