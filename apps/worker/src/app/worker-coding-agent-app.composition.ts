import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { AuthzApi } from "@langwatch/authz-contract";
import { codingAgentServer, type CodingAgentBillingPolicy } from "@langwatch/coding-agent-server";
import { CodingAgentApi } from "@langwatch/coding-agent-contract";
import { composeGithubApi, PostgresGithubRepositories } from "@langwatch/github-server";
import { GithubApi, type GithubServerConfig } from "@langwatch/github-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp, membersFrom } from "@langwatch/runtime-composition";

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
  // Kept for call-site compatibility; the v2 builder has no seam for the
  // bespoke infrastructure bag these still declare
  authorization: AuthzApi;
  billing: CodingAgentBillingPolicy;
  /** The process's routed query client the module's live tier reads. */
  clickhouse?: ClickHouseQueryClient;
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

  const runtime = await createApp({
    role: "worker",
    members: membersFrom({
      prisma: options.database,
      ...(options.clickhouse ? { clickhouse: options.clickhouse } : {}),
    }),
  })
    .withProvided(ProjectApi, options.projects)
    .withProvided(GithubApi, github)
    .withModules([codingAgentServer])
    .boot();

  return { app: runtime.module(codingAgentServer).provided, github };
}
