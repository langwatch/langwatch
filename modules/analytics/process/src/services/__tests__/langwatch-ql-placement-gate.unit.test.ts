/**
 * The placement gate every LangWatchQL run passes before any SQL runs (ADR-200).
 * Spec: specs/lwql/isolation.feature
 * @vitest-environment node
 */
import type { TenantRoute } from "@langwatch/clickhouse-client";
import { describe, expect, it } from "vitest";

import {
  createLangWatchQLService,
  EVERY_CATALOGUE_PERMISSION,
  RecordingLangWatchQLExecutor,
} from "../../app/__tests__/analytics.fixture.ts";
import type { LangWatchQLTarget } from "../../repositories/clickhouse/clickhouse.langwatch-ql-executor.repository.ts";
import { RoutedLangWatchQLExecutorRepository } from "../../repositories/clickhouse/clickhouse.langwatch-ql-routed-executor.repository.ts";
import {
  LWQL_ACCESS_MODEL_ANSWER_TTL_MS,
  type LangWatchQLAccessModelAnswerRepository,
} from "../../repositories/langwatch-ql-access-model-answer.repository.ts";
import type { LangWatchQLPlacementRepository } from "../../repositories/langwatch-ql-placement.repository.ts";
import { MemoryLangWatchQLAccessModelAnswerRepository } from "../../repositories/memory/memory.langwatch-ql-access-model-answer.repository.ts";
import {
  MEMORY_SHARED_ORIGIN,
  MemoryLangWatchQLPlacementRepository,
} from "../../repositories/memory/memory.langwatch-ql-placement.repository.ts";
import type { LwqlAccessModelOwner } from "../../rules/langwatch-ql-config-store.rules.ts";
import { LangWatchQLPlacementGateService } from "../langwatch-ql-placement-gate.service.ts";

const SHARED = { id: "project-shared", lwqlKey: "lwql-shared" };
const ROUTED = { id: "project-routed", lwqlKey: "lwql-routed" };
const UNROUTED = { id: "project-recorded-private", lwqlKey: "lwql-recorded-private" };

const UNREADABLE_ROUTE: Pick<LangWatchQLPlacementRepository, "placementOf"> = {
  placementOf: () => Promise.reject(new Error("tenant has no known organisation")),
};

const REDIS_DOWN: LangWatchQLAccessModelAnswerRepository = {
  findAnswer: () => Promise.reject(new Error("connect ECONNREFUSED 6379")),
  recordAnswer: () => Promise.reject(new Error("connect ECONNREFUSED 6379")),
};

/** A refusal's code, or `answered`. */
function codeOf(run: Promise<unknown>): Promise<string> {
  return run.then(
    () => "answered",
    (error: unknown) =>
      error instanceof Error && "code" in error ? String(error.code) : String(error),
  );
}

/**
 * The real service over a real routed executor, behind the real gate: `ROUTED` routes to its own
 * ClickHouse, every other project to the shared one. Records each route ask and executor built.
 */
function routedServiceOver() {
  const routeAsks: (readonly string[])[] = [];
  const built: { target: LangWatchQLTarget; executor: RecordingLangWatchQLExecutor }[] = [];
  const router = RoutedLangWatchQLExecutorRepository.create({
    connection: {
      url: MEMORY_SHARED_ORIGIN,
      username: "langwatch_lwql",
      password: "lwql-password",
      database: "analytics",
      tenantSetting: "custom_lwql_key_hash",
    },
    route: ({ tenantIds }) => {
      routeAsks.push(tenantIds);
      const route: TenantRoute = tenantIds.includes(ROUTED.id)
        ? {
            kind: "private",
            organizationId: "org-routed",
            url: "https://route-user:route-password@routed.invalid:8443/acme_db",
          }
        : { kind: "shared" };
      return Promise.resolve(route);
    },
    createExecutor: ({ target }) => {
      const executor = new RecordingLangWatchQLExecutor();
      built.push({ target, executor });
      return executor;
    },
  });
  const service = createLangWatchQLService({
    executor: router,
    database: "analytics",
    placement: LangWatchQLPlacementGateService.create({
      placement: MemoryLangWatchQLPlacementRepository.create({ routedTenants: [ROUTED.id] }),
      target: { configured: true, origin: MEMORY_SHARED_ORIGIN },
      accessModel: { configured: true, probeOwner: () => Promise.resolve("sql_store") },
      answers: MemoryLangWatchQLAccessModelAnswerRepository.create(),
    }),
  });
  const protections = { catalogue: EVERY_CATALOGUE_PERMISSION };
  const everyEntry = async (project: { id: string; lwqlKey: string }) => ({
    query: await codeOf(service.execute({ project, protections, sql: "SELECT 1" })),
    pass: await codeOf(
      service.executePass({
        project,
        protections,
        sql: "SELECT 1",
        pass: { kind: "probe" },
        isInstantEvalsEnabled: false,
      }),
    ),
    validation: await codeOf(
      service.validateForRun({ projectId: project.id, protections, sql: "SELECT 1" }),
    ),
  });
  return { everyEntry, routeAsks, built };
}

/** The real service over a recording executor, its gate over the given route and access model. */
function serviceOver({
  owner = () => Promise.resolve("sql_store"),
  configured = true,
  origin = MEMORY_SHARED_ORIGIN,
  answers = MemoryLangWatchQLAccessModelAnswerRepository.create(),
  placement = MemoryLangWatchQLPlacementRepository.create({
    routedTenants: [ROUTED.id],
    recordedPrivateTenants: [UNROUTED.id],
  }),
}: {
  owner?: () => Promise<LwqlAccessModelOwner>;
  configured?: boolean;
  origin?: string;
  answers?: LangWatchQLAccessModelAnswerRepository;
  placement?: Pick<LangWatchQLPlacementRepository, "placementOf">;
} = {}) {
  const executor = new RecordingLangWatchQLExecutor();
  let probes = 0;
  const service = createLangWatchQLService({
    executor,
    database: "analytics",
    placement: LangWatchQLPlacementGateService.create({
      placement,
      target: { configured: true, origin },
      accessModel: {
        configured,
        probeOwner: () => {
          probes += 1;
          return owner();
        },
      },
      answers,
    }),
  });
  const run = (project: { id: string; lwqlKey: string }) =>
    codeOf(
      service.execute({
        project,
        protections: { catalogue: EVERY_CATALOGUE_PERMISSION },
        sql: "SELECT 1",
      }),
    );
  return { executor, run, probes: () => probes };
}

describe("LangWatchQLPlacementGateService", () => {
  describe("given an organisation whose data is on the provisioned LangWatchQL server", () => {
    /** @scenario "An organisation on the shared server is answered" */
    it("lets the query through to the executor", async () => {
      const { executor, run } = serviceOver();

      expect(await run(SHARED)).toBe("answered");
      expect(executor.calls.length).toBeGreaterThan(0);
    });
  });

  describe("given an organisation routed to its own ClickHouse", () => {
    /** @scenario "An organisation routed to its own ClickHouse is refused before any SQL runs" */
    it("refuses lwql_not_provisioned and never calls the executor", async () => {
      const { executor, run } = serviceOver();

      expect(await run(ROUTED)).toBe("lwql_not_provisioned");
      expect(executor.calls).toEqual([]);
    });
  });

  describe("given a routed organisation behind a routed executor", () => {
    /** @scenario "A routed organisation is refused before its routed executor is built" */
    it("refuses lwql_not_provisioned at every entry, never asks its route and builds no executor for its ClickHouse", async () => {
      const { everyEntry, routeAsks, built } = routedServiceOver();

      expect(await everyEntry(ROUTED)).toEqual({
        query: "lwql_not_provisioned",
        pass: "lwql_not_provisioned",
        validation: "lwql_not_provisioned",
      });
      expect(routeAsks).toEqual([]);
      expect(built.map(({ target }) => target)).toEqual(["shared"]);
      expect(built.flatMap(({ executor }) => executor.calls)).toEqual([]);
    });

    /** @scenario "A routed organisation is refused before its routed executor is built" */
    it("asks the route for an admitted organisation, so the silence above is the gate's", async () => {
      const { everyEntry, routeAsks, built } = routedServiceOver();

      expect(await everyEntry(SHARED)).toEqual({
        query: "answered",
        pass: "answered",
        validation: "answered",
      });
      expect(routeAsks).toEqual([[SHARED.id], [SHARED.id], [SHARED.id]]);
      expect(built.map(({ target }) => target)).toEqual(["shared"]);
    });
  });

  describe("given a routed organisation whose server shares the LangWatchQL target's origin", () => {
    it("still refuses lwql_not_provisioned until the organisation is opted in", async () => {
      const { executor, run } = serviceOver({
        placement: {
          placementOf: () =>
            Promise.resolve({
              recordedPrivate: true,
              routedPrivately: true,
              origin: MEMORY_SHARED_ORIGIN,
            }),
        },
      });

      expect(await run(ROUTED)).toBe("lwql_not_provisioned");
      expect(executor.calls).toEqual([]);
    });
  });

  describe("given an organisation recorded private whose route variable is missing", () => {
    /** @scenario "An organisation recorded private whose route is missing is refused, never shared" */
    it("refuses lwql_unavailable, though its route resolves to the LangWatchQL server", async () => {
      const { executor, run } = serviceOver();

      expect(await run(UNROUTED)).toBe("lwql_unavailable");
      expect(executor.calls).toEqual([]);
    });
  });

  describe("given LangWatchQL pointed at a server other than the shared one", () => {
    it("refuses a shared organisation lwql_not_provisioned, comparing the servers themselves", async () => {
      const { executor, run } = serviceOver({ origin: "http://elsewhere.invalid:8123" });

      expect(await run(SHARED)).toBe("lwql_not_provisioned");
      expect(executor.calls).toEqual([]);
    });
  });

  describe("given the organisation's route cannot be read", () => {
    /** @scenario "A gate that cannot decide refuses rather than falling back" */
    it("refuses lwql_unavailable and never calls the executor", async () => {
      const { executor, run } = serviceOver({ placement: UNREADABLE_ROUTE });

      expect(await run(SHARED)).toBe("lwql_unavailable");
      expect(executor.calls).toEqual([]);
    });

    it("refuses lwql_unavailable when the access model cannot be probed", async () => {
      const { executor, run } = serviceOver({
        owner: () => Promise.reject(new Error("connect ECONNREFUSED")),
      });

      expect(await run(SHARED)).toBe("lwql_unavailable");
      expect(executor.calls).toEqual([]);
    });

    it("refuses lwql_unavailable when the store holding the answer fails", async () => {
      const { executor, run, probes } = serviceOver({ answers: REDIS_DOWN });

      expect(await run(SHARED)).toBe("lwql_unavailable");
      expect(executor.calls).toEqual([]);
      expect(probes()).toBe(0);
    });
  });

  describe("given config names no server to hold the access model", () => {
    it("refuses lwql_not_provisioned without probing or reading the stored answer", async () => {
      const { executor, run, probes } = serviceOver({ configured: false, answers: REDIS_DOWN });

      expect(await run(SHARED)).toBe("lwql_not_provisioned");
      expect(executor.calls).toEqual([]);
      expect(probes()).toBe(0);
    });
  });

  describe("given a self-hosted install whose ClickHouse has no access model", () => {
    /** @scenario "A self-hosted install answers only once LangWatchQL is enabled and provisioned" */
    it("refuses lwql_not_provisioned, then answers once provisioned and the answer expired", async () => {
      let now = 1_000_000;
      let owner: LwqlAccessModelOwner = "none";
      const { executor, run, probes } = serviceOver({
        owner: () => Promise.resolve(owner),
        answers: MemoryLangWatchQLAccessModelAnswerRepository.create({ now: () => now }),
      });

      expect(await run(SHARED)).toBe("lwql_not_provisioned");
      owner = "config_store";
      now += LWQL_ACCESS_MODEL_ANSWER_TTL_MS - 1;
      expect(await run(SHARED)).toBe("lwql_not_provisioned");
      expect(executor.calls).toEqual([]);
      expect(probes()).toBe(1);

      now += 1;
      expect(await run(SHARED)).toBe("answered");
      expect(await run(SHARED)).toBe("answered");
      expect(probes()).toBe(2);
    });
  });
});
