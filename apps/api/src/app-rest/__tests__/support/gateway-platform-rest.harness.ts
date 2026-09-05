/**
 * The gateway platform REST family, mounted the way this process mounts it, over a real
 * Postgres and a real ClickHouse.
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { AesGcmSecretEncryptionAdapter } from "@langwatch/secret-server";
import { PostgresAuthzAdapter } from "@langwatch/authz-server";
import { createGatewayPlatformRestApp } from "@langwatch/gateway-server";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaConnection,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import { Hono } from "hono";

import { ApiRestSecurity } from "../../../api-rest.security";
import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition";
import { ApiTenancyComposition } from "../../../app/api-tenancy.composition";
import { composeApiGateway } from "../../../app/api-gateway.composition";
import { composeApiIdempotency } from "../../../app/api-idempotency.composition";

/** 32 bytes of hex, which is what the stored-secret cipher refuses anything else for. */
const CREDENTIALS_SECRET = "c".repeat(64);
const API_KEY_PEPPER = "gateway-rest-harness-pepper";
const VIRTUAL_KEY_PEPPER = "gateway-rest-harness-vk-pepper";

/** Test rows are seeded by id, which the multitenancy guard has no context for. */
class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

export const databaseUrl = process.env.DATABASE_URL;

/**
 * `TEST_CLICKHOUSE_URL` names a database of its own and is taken verbatim.
 * `CI_CLICKHOUSE_URL` is the job-wide server, whose test database is
 * `test_langwatch` — the one the job migrates.
 */
export function testClickHouseUrl(): URL | null {
  const configured = process.env.TEST_CLICKHOUSE_URL ?? process.env.CI_CLICKHOUSE_URL;
  if (!configured) return null;
  const url = new URL(configured);
  if (!process.env.TEST_CLICKHOUSE_URL) url.pathname = "/test_langwatch";
  return url;
}

export function createTestClickHouseClient(url: URL): ClickHouseClient {
  return createClient({
    url,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
}

export const clickHouseUrl = testClickHouseUrl();

let connection: PrismaConnection | null = null;

/** The one guarded connection every fixture row and every route read runs on. */
export function testPrisma(): PrismaClient {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for this suite");
  connection ??= PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
    PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
  );
  return connection.client as PrismaClient;
}

export type GatewayRestHarness = {
  /** Drives one request through the mounted family, exactly as Hono serves it. */
  request(path: string, init?: RequestInit): Promise<Response>;
  prisma: PrismaClient;
  clickhouse: ClickHouseClient;
  /** The API-key service the suite mints scoped credentials through. */
  apiKeys: ApiTenancyComposition["apiKeys"];
  /** The ClickHouse budget ledger the routes price a budget against. */
  budgetSpend: NonNullable<ReturnType<typeof composeApiGateway>["budgetSpend"]>;
  encryption: AesGcmSecretEncryptionAdapter;
  apiKeyPepper: string;
};

/**
 * Composes the family once for a suite. Everything below `createGatewayPlatformRestApp`
 * is the process's own composition root: a second description of any of it here would be
 * a harness that passed while production refused.
 */
export function mountGatewayPlatformRest(): GatewayRestHarness {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for this suite");
  if (!clickHouseUrl) throw new Error("a test ClickHouse is required for this suite");

  const prisma = testPrisma();
  if (!connection) throw new Error("the guarded connection did not open");
  const clickhouse = createTestClickHouseClient(clickHouseUrl);
  const encryption = AesGcmSecretEncryptionAdapter.create({ key: CREDENTIALS_SECRET });

  const authzBuild = PostgresAuthzAdapter.create({
    database: prisma,
    redis: null,
    // Reads answer from role bindings; a grant WRITE would need this process's
    // eventing, which no suite here makes.
    dispatcher: {
      commands: () => {
        throw new Error("this suite writes no AuthZ grants");
      },
    } as never,
    newBindingId: () => `authzbinding_${Math.random().toString(36).slice(2)}`,
  }).build();

  const tenancy = ApiTenancyComposition.compose({
    database: connection,
    authz: { permissions: authzBuild.authz, grants: authzBuild.grants },
    encryption,
    pepper: API_KEY_PEPPER,
  });

  const idempotency = composeApiIdempotency({ database: prisma, encryption });

  const gateway = composeApiGateway({
    prisma,
    authz: authzBuild.authz,
    projects: tenancy.projects,
    evaluators: {} as unknown as EvaluatorService,
    monitors: {} as unknown as MonitorService,
    clickhouse: { resolve: async () => clickhouse as never },
    virtualKeyPepper: VIRTUAL_KEY_PEPPER,
    ...(idempotency ? { idempotency: idempotency.gateway } : {}),
  });

  const security = ApiRestSecurity.create({
    apiKeys: tenancy.apiKeys,
    authz: authzBuild.authz,
    organizations: tenancy.organizations,
    observability: ApiRestObservabilityComposition.create(),
  });

  const hono = new Hono();
  hono.route(
    "/",
    createGatewayPlatformRestApp({ security, gateway: () => gateway.app }).hono as never,
  );

  return {
    request: async (path, init) => hono.fetch(new Request(`http://api.test${path}`, init)),
    prisma,
    clickhouse,
    apiKeys: tenancy.apiKeys,
    budgetSpend: gateway.budgetSpend!,
    encryption,
    apiKeyPepper: API_KEY_PEPPER,
  };
}
