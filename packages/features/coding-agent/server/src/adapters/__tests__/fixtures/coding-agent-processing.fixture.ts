import { CodingAgentProjectionPersistence } from "@langwatch/coding-agent-contract";
import type { GithubService } from "@langwatch/github-contract";
import {
  ModelProviderService,
  type ModelCostEstimateInput,
} from "@langwatch/model-provider-contract";
import { TraceCanonicalisationService } from "@langwatch/trace-contract";
import Redis from "ioredis";
import { EventingCodingAgentProcessingAdapter } from "../../eventing.coding-agent-processing.adapter";
import { CodingAgentCostMetricsPort } from "../../../ports/coding-agent-cost-metrics.port";
import { TestClock, TestProjectService } from "../../../repositories/__tests__/fixtures/coding-agent.fixture";

class NoopCostMetrics extends CodingAgentCostMetricsPort {
  recordComputed(): void {}

  recordReported(): void {}
}

class NoopCodingAgentProjectionPersistence extends CodingAgentProjectionPersistence {
  storeSession(): Promise<void> {
    return Promise.resolve();
  }

  storeSessionBatch(): Promise<void> {
    return Promise.resolve();
  }

  loadSessionWithApplied(): Promise<null> {
    return Promise.resolve(null);
  }

  appendTraceSessions(): Promise<void> {
    return Promise.resolve();
  }

  appendMetricSeries(): Promise<void> {
    return Promise.resolve();
  }

  appendSessionEvents(): Promise<void> {
    return Promise.resolve();
  }
}

class TestTraceCanonicalisationService extends TraceCanonicalisationService {
  canonicalizeSpanAttributes() {
    return { attributes: {}, events: [], appliedRules: [] };
  }

  canonicalizeLogRecord() {
    return { attributes: {}, appliedRules: [] };
  }

  tryExtractMessageText(): null {
    return null;
  }

  deriveClaudeRequestContent() {
    return { messages: null, toolResults: [] };
  }

  deriveClaudeResponseContent() {
    return {
      assistantText: null,
      assistantOutput: null,
      sessionTitle: null,
    };
  }

  classifyClaudeCall() {
    return { conversational: false, cacheWritesLongLived: false };
  }
}

const redis = new Redis({ lazyConnect: true });

export class TestModelProviderService extends ModelProviderService {
  constructor(
    private readonly estimate: (input: ModelCostEstimateInput) => number = () => 0,
  ) {
    super();
  }

  estimateCost(input: ModelCostEstimateInput): number {
    return this.estimate(input);
  }

  listForProject(): Promise<[]> {
    return Promise.resolve([]);
  }

  listForOrganization(): Promise<[]> {
    return Promise.resolve([]);
  }

  getForProject(): Promise<Record<string, never>> {
    return Promise.resolve({});
  }

  tryGetProviderForProject(): Promise<null> {
    return Promise.resolve(null);
  }

  tryFindRowServingModel(): Promise<null> {
    return Promise.resolve(null);
  }

  getExecutionProviders(): Promise<Record<string, never>> {
    return Promise.resolve({});
  }

  prepareExecution(): Promise<Record<string, string>> {
    return Promise.resolve({});
  }

  upsert(): Promise<never> {
    throw new Error("Not used by Coding Agent tests.");
  }

  delete(): Promise<void> {
    return Promise.resolve();
  }

  validateApiKey(): Promise<never> {
    throw new Error("Not used by Coding Agent tests.");
  }

  testConnection(): Promise<{ connected: boolean }> {
    return Promise.resolve({ connected: false });
  }

  getCodexStatus(): Promise<never> {
    throw new Error("Not used by Coding Agent tests.");
  }

  refreshCodexForGateway(): Promise<never> {
    throw new Error("Not used by Coding Agent tests.");
  }

  isManagedProvider(): boolean {
    return false;
  }

  getDefaultSnapshot(): Promise<never> {
    throw new Error("Not used by Coding Agent tests.");
  }

  getInheritedValues(): Promise<never> {
    throw new Error("Not used by Coding Agent tests.");
  }

  tryGetResolvedDefault(): Promise<null> {
    return Promise.resolve(null);
  }

  resolveModelForFeature(): Promise<never> {
    throw new Error("Not used by Coding Agent tests.");
  }

  findAlternateModel(): Promise<never> {
    throw new Error("Not used by Coding Agent tests.");
  }

  setDefault(): Promise<void> {
    return Promise.resolve();
  }

  saveDefaultConfig(): Promise<never> {
    throw new Error("Not used by Coding Agent tests.");
  }

  tryGetDefaultConfig(): Promise<null> {
    return Promise.resolve(null);
  }

  deleteDefaultConfig(): Promise<void> {
    return Promise.resolve();
  }

  listCosts(): Promise<[]> {
    return Promise.resolve([]);
  }

  upsertCost(): Promise<never> {
    throw new Error("Not used by Coding Agent tests.");
  }

  deleteCost(): Promise<void> {
    return Promise.resolve();
  }

  translate(): Promise<never> {
    throw new Error("Not used by Coding Agent tests.");
  }
}

/** Builds the real pipeline definition without opening its runtime adapters. */
export function buildTestCodingAgentProcessingPipeline(
  github?: GithubService,
  foldCacheTtlSeconds?: number,
) {
  return EventingCodingAgentProcessingAdapter.create({
    traceCanonicalisation: new TestTraceCanonicalisationService(),
    modelProviders: new TestModelProviderService(),
    costMetrics: new NoopCostMetrics(),
    projections: new NoopCodingAgentProjectionPersistence(),
    projects: new TestProjectService(),
    clock: new TestClock(),
    redis,
    defaultRetentionDays: 365,
    foldCacheTtlSeconds,
    github,
  }).build();
}
