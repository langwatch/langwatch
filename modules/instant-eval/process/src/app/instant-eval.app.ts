import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  type InstantEvalApi as InstantEvalApiContract,
  InstantEvalApi,
  type InstantEvalJudgmentStatus,
  type InstantEvalResultsWire,
  type InstantEvalRunProgress,
  type InstantEvalRunWire,
  type InstantEvalServerConfig,
  instantEvalConfig,
} from "@langwatch/instant-eval-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { ProjectApi } from "@langwatch/project-contract";
import { Secret } from "@langwatch/secrets";
import type { Instant } from "@langwatch/time";

import { HttpInstantEvalJudgeChannel } from "../channels/http/http.instant-eval-judge.channel.ts";
import type { InstantEvalJudgeChannel } from "../channels/instant-eval-judge.channel.ts";
import { MemoryInstantEvalJudgeChannel } from "../channels/memory/memory.instant-eval-judge.channel.ts";
import {
  type InstantEvalRateLimiterRedis,
  RedisInstantEvalRateLimiterChannel,
} from "../channels/redis/redis.instant-eval-rate-limiter.channel.ts";
import { ClickHouseInstantEvalRepositories } from "../repositories/clickhouse/clickhouse.instant-eval.repositories.ts";
import type { InstantEvalRepositories } from "../repositories/instant-eval.repositories.ts";
import {
  toInstantEvalJudgmentWire,
  toInstantEvalRunWire,
} from "../rules/instant-eval-wire.rules.ts";
import { InstantEvalAccessService } from "../services/instant-eval-access.service.ts";
import { InstantEvalReadsService } from "../services/instant-eval-reads.service.ts";
import type {
  InstantEvalClickHouseClient,
  InstantEvalClickHouseResolver,
} from "./instant-eval.members.ts";

/** Seconds of refill a bucket holds as burst, at the sustained rate. */
const BUCKET_BURST_SECONDS = 2;

/**
 * The process's one routing ClickHouse member, carried per tenant. Not a
 * second connection — the member already routes and guards every statement.
 */
type InstantEvalClickHouseMember = {
  query<T>(input: {
    tenantId: string;
    sql: string;
    params?: Record<string, unknown>;
    settings?: Record<string, string | number>;
  }): Promise<{ rows: T[] }>;
  insert(input: {
    tenantId: string;
    table: string;
    rows: Record<string, unknown>[];
    settings?: Record<string, string | number>;
  }): Promise<unknown>;
};

type InstantEvalMembers = Readonly<{
  clickhouse: InstantEvalClickHouseMember;
  /** The shared token bucket the judge is paced by, absent in a memory process. */
  redis: InstantEvalRateLimiterRedis | null;
}>;

type InstantEvalDependencies = Readonly<{
  featureFlags: typeof FeatureFlagApi;
  projects: typeof ProjectApi;
}>;

type InstantEvalSetup = FeatureSetup<
  InstantEvalDependencies,
  InstantEvalMembers,
  InstantEvalServerConfig
>;

class ClickHouseMemberSession implements InstantEvalClickHouseClient {
  constructor(
    private readonly clickhouse: InstantEvalClickHouseMember,
    private readonly tenantId: string,
  ) {}

  async query<T>(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
  }): Promise<{ json(): Promise<T[]> }> {
    const { rows } = await this.clickhouse.query<T>({
      tenantId: this.tenantId,
      sql: input.query,
      ...(input.query_params ? { params: input.query_params } : {}),
      ...(input.clickhouse_settings ? { settings: settingsOf(input.clickhouse_settings) } : {}),
    });
    return { json: () => Promise.resolve(rows) };
  }

  async insert(input: {
    table: string;
    values: Record<string, unknown>[];
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
  }): Promise<unknown> {
    await this.clickhouse.insert({
      tenantId: this.tenantId,
      table: input.table,
      rows: input.values,
      ...(input.clickhouse_settings ? { settings: settingsOf(input.clickhouse_settings) } : {}),
    });
    return undefined;
  }
}

/** The settings the member takes: booleans and absences dropped. */
function settingsOf(
  settings: Record<string, string | number | boolean | undefined>,
): Record<string, string | number> {
  const carried: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(settings)) {
    if (typeof value === "string" || typeof value === "number") carried[name] = value;
    else if (typeof value === "boolean") carried[name] = value ? 1 : 0;
  }
  return carried;
}

export class InstantEvalApp implements InstantEvalApiContract {
  static readonly contract = InstantEvalApi;
  static readonly dependencies = {
    featureFlags: FeatureFlagApi,
    projects: ProjectApi,
  };
  static readonly config = instantEvalConfig;
  /** LangWatch's own judge credential; a deployment without one judges nothing. */
  static readonly secrets = {
    classifierApiKey: Secret.load("JEV_API_KEY", { optional: true }),
  } as const;
  /**
   * `clickhouse` is where both of this module's tables live; `redis` is the
   * shared token bucket that paces the judge across every pod.
   */
  static readonly reads = ["clickhouse", "redis"] as const;

  private constructor(
    private readonly access: InstantEvalAccessService,
    private readonly reads: InstantEvalReadsService,
  ) {}

  static async create(setup: InstantEvalSetup): Promise<InstantEvalApp> {
    return setup.secrets.into(InstantEvalApp.secrets.classifierApiKey, (apiKey) =>
      InstantEvalApp.withSecrets(setup, apiKey),
    );
  }

  private static withSecrets(setup: InstantEvalSetup, apiKey: string | undefined): InstantEvalApp {
    const repositories = InstantEvalApp.repositoriesOf(setup);
    const judge = InstantEvalApp.judgeOf(setup, apiKey);
    setup.resources.own("Instant Evals judge", () => judge.close?.() ?? Promise.resolve());

    return new InstantEvalApp(
      InstantEvalAccessService.create({
        flags: setup.dependencies.featureFlags,
        projects: setup.dependencies.projects,
        isJudgeConfigured: () => judge instanceof HttpInstantEvalJudgeChannel,
      }),
      InstantEvalReadsService.create({
        runs: repositories.runs,
        judgments: repositories.judgments,
      }),
    );
  }

  private static repositoriesOf(setup: InstantEvalSetup): InstantEvalRepositories {
    const clickhouse = setup.members.clickhouse;
    const resolveClient: InstantEvalClickHouseResolver = (tenantId) =>
      Promise.resolve(new ClickHouseMemberSession(clickhouse, tenantId));
    return ClickHouseInstantEvalRepositories.create({ resolveClient });
  }

  /**
   * Fail-safe rather than fail-closed: no key means the memory judge, which
   * skips every question instead of refusing every query, so a self-hosted
   * install sees the eval functions unavailable rather than broken.
   */
  private static judgeOf(
    setup: InstantEvalSetup,
    apiKey: string | undefined,
  ): InstantEvalJudgeChannel {
    if (setup.config.classifier === "null" || !apiKey) {
      return MemoryInstantEvalJudgeChannel.create();
    }
    const tokensPerSecond = setup.config.globalTokensPerSecond;
    const tenantTokensPerSecond = Math.min(tokensPerSecond, setup.config.tenantTokensPerSecond);
    return HttpInstantEvalJudgeChannel.create({
      apiKey,
      ...(setup.config.classifierBaseUrl ? { baseUrl: setup.config.classifierBaseUrl } : {}),
      ...(setup.config.classifierModel ? { model: setup.config.classifierModel } : {}),
      limiter: RedisInstantEvalRateLimiterChannel.create({
        redis: setup.members.redis,
        tokensPerSecond,
        capacity: tokensPerSecond * BUCKET_BURST_SECONDS,
        tenantTokensPerSecond,
        tenantCapacity: tenantTokensPerSecond * BUCKET_BURST_SECONDS,
      }),
    });
  }

  async isEnabled(input: { projectId: string }): Promise<boolean> {
    return this.access.isEnabled(input);
  }

  async isReleased(input: { projectId: string }): Promise<boolean> {
    return this.access.isReleased(input);
  }

  async findRuns(input: {
    projectId: string;
    limit: number;
    before?: Instant;
    beforeId?: string;
  }): Promise<InstantEvalRunWire[]> {
    const rows = await this.reads.findRuns(input);
    return rows.map(toInstantEvalRunWire);
  }

  async getRun(input: { projectId: string; runId: string }): Promise<InstantEvalRunWire> {
    return toInstantEvalRunWire(await this.reads.getRun(input));
  }

  async getResultsPage(input: {
    projectId: string;
    runId: string;
    limit: number;
    questionId?: string;
    isMatched?: boolean;
    status?: InstantEvalJudgmentStatus;
    cursor?: string;
  }): Promise<InstantEvalResultsWire> {
    const page = await this.reads.getResultsPage(input);
    return {
      judgments: page.judgments.map(toInstantEvalJudgmentWire),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    };
  }

  async findRunProgress(input: {
    projectId: string;
    runIds: readonly string[];
  }): Promise<InstantEvalRunProgress[]> {
    return this.reads.findRunProgress(input);
  }
}
