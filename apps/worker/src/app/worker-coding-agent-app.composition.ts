import type { ClickHouseClient } from "@clickhouse/client";
import type { AuthzApi } from "@langwatch/authz-contract";
import { codingAgentServer, type CodingAgentBillingPolicy } from "@langwatch/coding-agent-server";
import { CodingAgentApi } from "@langwatch/coding-agent-contract";
import { composeGithubApi, PostgresGithubRepositories } from "@langwatch/github-server";
import { GithubApi, type GithubServerConfig } from "@langwatch/github-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp } from "@langwatch/runtime-composition";

/** Minimal Redis surface owned by GitHub's private adapter. */
export type WorkerGithubRedisConnection = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: (string | number)[]): Promise<string | null>;
  del(key: string): Promise<number>;
  getdel?: (key: string) => Promise<string | null>;
  eval?: (script: string, numKeys: number, ...args: string[]) => Promise<number | string | null>;
};

/** The composed worker capability and its shared projection persistence. */
export type WorkerCodingAgent = Readonly<{
  app: CodingAgentApi;
  github: GithubApi;
}>;

/**
 * Builds the coding-agent read application over the worker's existing graph, booted
 * through the same `createApp().withModule().boot()` path every other module boots
 * through, rather than a hand-built `CodingAgentApp.create(...)` call.
 * The app owns its projection adapter, while the event pipeline owns its
 * processing adapter over the same tenant-keyed ClickHouse storage.
 */
export async function createWorkerCodingAgentApp(options: {
  database: PrismaConnection["client"];
  organizations: OrganizationApi;
  projects: ProjectApi;
  /**
   * No longer wired: `CodingAgentApp` still declares a bespoke infrastructure
   * bag (billing, scope directory, scope permissions, content visibility,
   * audit sink — see `modules/coding-agent/server/src/app/coding-agent.app.ts`)
   * that the v2 builder has no seam for, since the module has not yet
   * declared its own `reads()`. Kept on this options record purely for
   * call-site compatibility with `worker-observability-apps.composition.ts`;
   * closing the gap is the coding-agent module's own conversion, not this
   * composition's.
   */
  authorization: AuthzApi;
  billing: CodingAgentBillingPolicy;
  /**
   * No longer wired: the module's live tier now reads a "clickhouse" process
   * member typed `ClickHouseQueryClient` (see
   * `modules/coding-agent/server/src/repositories/clickhouse/clickhouse.coding-agent.repositories.ts`),
   * not the per-tenant `resolve` this process holds. Left unsupplied so the
   * live tier refuses by name at boot rather than being silently downgraded
   * to memory.
   */
  clickHouse: { resolve(tenantId: string): Promise<ClickHouseClient> } | null;
  /**
   * No longer wired: the live tier now hardcodes its retention default (see
   * the same repositories file) — a member vocabulary may only name process
   * clients, not a per-deployment number.
   */
  defaultTraceRetentionDays: number;
  redis: WorkerGithubRedisConnection | null;
  github: GithubServerConfig;
  signingKey: string;
}): Promise<WorkerCodingAgent> {
  const github = composeGithubApi({
    repositories: PostgresGithubRepositories.create({ prisma: options.database }),
    redis: options.redis,
    organization: options.organizations,
    project: options.projects,
    config: {
      appId: options.github.appId ?? "",
      privateKey: options.github.privateKey ?? "",
      appSlug: options.github.appSlug ?? "",
      webhookSecret: options.github.webhookSecret ?? "",
      signingKey: options.signingKey,
    },
    ...(options.github.host === undefined ? {} : { hostConfig: { host: options.github.host } }),
  });

  const runtime = await createApp({ role: "worker" })
    .withProvided(ProjectApi, options.projects)
    .withProvided(GithubApi, github)
    .withModules([codingAgentServer])
    .boot();

  return { app: runtime.module(codingAgentServer).provided, github };
}
