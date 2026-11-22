/**
 * The query family mounted the way the API process mounts it, over a credential resolution that
 * authenticates one tenant. Only the credential chain is faked.
 * @vitest-environment node
 */
import {
  langWatchQLKeyDoor,
  langWatchQLKeyReach,
  MAX_LWQL_LENGTH,
  type LangWatchQLKeyDoor,
  type LangWatchQLKeyReach,
  type LangWatchQLProtections,
} from "@langwatch/analytics-contract";
import {
  bindMiddlewareContext,
  canonicalErrorResponse,
  createRestRuntime,
} from "@langwatch/api/rest";
import { censusClientOf } from "@langwatch/observability/credential-census";
import { LocalFeatureApis } from "@langwatch/process";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { TRACE_FILTER_EXAMPLES } from "@langwatch/trace-contract";
import { Hono } from "hono";

import { LWQL_EXAMPLE_DATABASE } from "../../rules/langwatch-ql-examples.rules.ts";
import { keyDoorOfClient } from "../../rules/langwatch-ql-key-caller.rules.ts";
import { buildQueryReference } from "../../rules/query-reference.rules.ts";
import { EVERY_CATALOGUE_PERMISSION } from "../../services/__tests__/lwql-catalogue-access.fixture.ts";
import type { LangWatchQLService } from "../../services/langwatch-ql.service.ts";
import { AnalyticsQueryApi, queryRest } from "../query.rest.ts";

const FULLY_PERMITTED: LangWatchQLProtections = {
  catalogue: EVERY_CATALOGUE_PERMISSION,
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

/** A tenant the door authenticates as, in the shape the credential resolves to. */
export interface QueryTenant {
  id: string;
  lwqlKey: string;
}

/**
 * The query family, mounted the way the API process mounts it, over a credential resolution
 * that authenticates one tenant. Only the credential chain is faked.
 */
export function mountQueryDoor({
  tenant,
  service,
  protections = FULLY_PERMITTED,
  reach = () => ({ kind: "project", projectId: tenant().id }),
}: {
  tenant: () => QueryTenant;
  service: () => LangWatchQLService;
  /** What the authenticated key's project lets it see; fully permitted when absent. */
  protections?: LangWatchQLProtections;
  /** The credential the key door resolves, before the context schema parses it. */
  reach?: () => LangWatchQLKeyReach;
}): {
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  /** Every key reach the door handed the application, in order. */
  reaches: LangWatchQLKeyReach[];
  /** The client each query named, in order. */
  doors: (LangWatchQLKeyDoor | undefined)[];
} {
  const reaches: LangWatchQLKeyReach[] = [];
  const doors: (LangWatchQLKeyDoor | undefined)[] = [];
  // An API key resolves its organization; the key-reach context below fans it out to the tenant.
  const keyScope = () => ({ tier: "organization" as const, id: `org-of-${tenant().id}` });

  const runtime = createRestRuntime({
    authorization: restTestAuthorization(),
    // The whole of the credential chain this test fakes: one authenticated key.
    identity: {
      authenticate: () => ({ actor: { type: "api_key", id: "key-asking" }, scope: keyScope() }),
      identify: () => ({ actor: { type: "api_key", id: "key-asking" }, scope: keyScope() }),
    },
  });

  // The scope a key resolves to, faked: the one authenticated tenant.
  const queryApi: AnalyticsQueryApi = {
    runLangWatchQLForKey: ({
      reach: asked,
      door,
      sql,
      parameters,
      timeWindow,
      granularitySeconds,
    }) => {
      reaches.push(asked);
      doors.push(door);
      return service().executeForProjects({
        projects: [tenant()],
        protections,
        sql,
        ...(parameters ? { parameters } : {}),
        ...(timeWindow ? { timeWindow } : {}),
        ...(granularitySeconds === undefined ? {} : { granularitySeconds }),
      });
    },
    describeLangWatchQLSchemaForKey: async ({ reach: asked }) => {
      reaches.push(asked);
      return service().describeSchema({ protections });
    },
    describeQueryReferenceForKey: async ({ reach: asked }) => {
      reaches.push(asked);
      return buildQueryReference({
        protections,
        lwqlEnabled: true,
        database: LWQL_EXAMPLE_DATABASE,
        schema: service().describeSchema({ protections }),
        limits: {
          maxStatementLength: MAX_LWQL_LENGTH,
          maxRowsReturned: 10_000,
          maxResultBytes: 8_000_000,
          maxExecutionTimeSeconds: 10,
        },
        traceFilterExamples: TRACE_FILTER_EXAMPLES,
      });
    },
  };

  // Reached through the operations-only feature-API proxy, the way the
  // composition hands an application to a door: a route naming an operation
  // the application does not serve must fail here rather than in production.
  const apis = new LocalFeatureApis();
  apis.declare(AnalyticsQueryApi);
  apis.bind(AnalyticsQueryApi, queryApi);
  apis.ready();

  const app = new Hono().route(
    "/",
    runtime.mount(queryRest.router(), {
      app: () => apis.reference(AnalyticsQueryApi),
      onError: canonicalErrorResponse,
      middlewareContext: [
        bindMiddlewareContext(langWatchQLKeyReach, () => reach()),
        // As the analytics module resolves it, from the request's identity headers.
        bindMiddlewareContext(langWatchQLKeyDoor, (request) =>
          keyDoorOfClient({ client: censusClientOf((name) => request.headers.get(name)).client }),
        ),
      ],
    }),
  );

  return {
    reaches,
    doors,
    fetch: async (path: string, init?: RequestInit) =>
      app.fetch(new Request(`http://api.test${path}`, init)),
  };
}

/**
 * The query family over a real application rather than a fake: for what the application does
 * around a run, such as counting one it refuses before the engine.
 */
export function mountQueryDoorOverApp({
  app,
  reach,
}: {
  app: AnalyticsQueryApi;
  reach: () => LangWatchQLKeyReach;
}): { fetch: (path: string, init?: RequestInit) => Promise<Response> } {
  const runtime = createRestRuntime({
    authorization: restTestAuthorization(),
    identity: {
      authenticate: () => ({
        actor: { type: "api_key", id: "key-asking" },
        scope: { tier: "organization" as const, id: "org-1" },
      }),
      identify: () => ({
        actor: { type: "api_key", id: "key-asking" },
        scope: { tier: "organization" as const, id: "org-1" },
      }),
    },
  });
  const apis = new LocalFeatureApis();
  apis.declare(AnalyticsQueryApi);
  apis.bind(AnalyticsQueryApi, app);
  apis.ready();
  const mounted = new Hono().route(
    "/",
    runtime.mount(queryRest.router(), {
      app: () => apis.reference(AnalyticsQueryApi),
      onError: canonicalErrorResponse,
      middlewareContext: [
        bindMiddlewareContext(langWatchQLKeyReach, () => reach()),
        bindMiddlewareContext(langWatchQLKeyDoor, (request) =>
          keyDoorOfClient({ client: censusClientOf((name) => request.headers.get(name)).client }),
        ),
      ],
    }),
  );
  return {
    fetch: async (path, init) => mounted.fetch(new Request(`http://api.test${path}`, init)),
  };
}
