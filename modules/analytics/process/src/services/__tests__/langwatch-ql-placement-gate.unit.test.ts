/**
 * The placement gate every LangWatchQL run passes before any SQL runs (ADR-200).
 * Spec: specs/lwql/isolation.feature
 * Spec: modules/analytics/specs/analytics-lwql-access-model-answer.feature
 * @vitest-environment node
 */
import type * as Observability from "@langwatch/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLangWatchQLService,
  EVERY_CATALOGUE_PERMISSION,
  RecordingLangWatchQLExecutor,
} from "../../app/__tests__/analytics.fixture.ts";
import { LWQL_RECONVERGENCE_INTERVAL_MS } from "../../eventing/analytics-lwql-reconvergence.process.ts";
import {
  LWQL_ACCESS_MODEL_ANSWER_TTL_MS,
  type LangWatchQLAccessModelAnswer,
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

const { warnings } = vi.hoisted(() => ({ warnings: [] as string[] }));
vi.mock("@langwatch/observability", async (importActual) => {
  const actual = await importActual<typeof Observability>();
  const quiet = () => undefined;
  return {
    ...actual,
    createLogger: () => ({
      info: quiet,
      debug: quiet,
      error: quiet,
      warn: (...args: unknown[]) => warnings.push(String(args.at(-1))),
    }),
  };
});

beforeEach(() => {
  warnings.length = 0;
});

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

/**
 * The real service over a recording executor, its gate over the given route and access model.
 * `stored` is the answer a worker stored before the first run; `owner: null` cannot probe.
 */
function serviceOver({
  owner = () => Promise.resolve("sql_store"),
  configured = true,
  origin = MEMORY_SHARED_ORIGIN,
  answers = MemoryLangWatchQLAccessModelAnswerRepository.create(),
  stored = "provisioned",
  placement = MemoryLangWatchQLPlacementRepository.create({
    routedTenants: [ROUTED.id],
    recordedPrivateTenants: [UNROUTED.id],
  }),
}: {
  owner?: (() => Promise<LwqlAccessModelOwner>) | null;
  configured?: boolean;
  origin?: string;
  answers?: LangWatchQLAccessModelAnswerRepository;
  stored?: LangWatchQLAccessModelAnswer | null;
  placement?: Pick<LangWatchQLPlacementRepository, "placementOf">;
} = {}) {
  const executor = new RecordingLangWatchQLExecutor();
  let probes = 0;
  const gate = LangWatchQLPlacementGateService.create({
    placement,
    target: { configured: true, origin },
    accessModel: {
      configured,
      probeOwner:
        owner === null
          ? null
          : () => {
              probes += 1;
              return owner();
            },
    },
    answers,
  });
  const service = createLangWatchQLService({ executor, database: "analytics", placement: gate });
  const ready =
    stored === null ? Promise.resolve() : answers.recordAnswer({ origin, answer: stored });
  const run = async (project: { id: string; lwqlKey: string }) => {
    await ready;
    return service
      .execute({ project, protections: { catalogue: EVERY_CATALOGUE_PERMISSION }, sql: "SELECT 1" })
      .then(
        () => "answered",
        (error: unknown) =>
          error instanceof Error && "code" in error ? String(error.code) : String(error),
      );
  };
  return {
    executor,
    run,
    answers,
    refresh: () => gate.refreshAccessModelAnswer(),
    probes: () => probes,
  };
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

    it("refuses lwql_unavailable when the store holding the answer fails", async () => {
      const { executor, run, probes } = serviceOver({ answers: REDIS_DOWN, stored: null });

      expect(await run(SHARED)).toBe("lwql_unavailable");
      expect(executor.calls).toEqual([]);
      expect(probes()).toBe(0);
    });
  });

  describe("given config names no server to hold the access model", () => {
    it("refuses lwql_not_provisioned without probing or reading the stored answer", async () => {
      const { executor, run, probes } = serviceOver({
        configured: false,
        answers: REDIS_DOWN,
        stored: null,
      });

      expect(await run(SHARED)).toBe("lwql_not_provisioned");
      expect(executor.calls).toEqual([]);
      expect(probes()).toBe(0);
    });

    /** @scenario "A process that names no LangWatchQL server, or holds no identity to probe with, stores nothing" */
    it("stores no answer when the worker refreshes", async () => {
      const { answers, refresh, probes } = serviceOver({ configured: false, stored: null });

      await refresh();

      expect(await answers.findAnswer({ origin: MEMORY_SHARED_ORIGIN })).toBeNull();
      expect(probes()).toBe(0);
    });
  });

  describe("given a process holding the LangWatchQL server without the system credential", () => {
    /** @scenario "A process that names no LangWatchQL server, or holds no identity to probe with, stores nothing" */
    it("probes nothing and stores nothing when asked to refresh", async () => {
      const { answers, refresh } = serviceOver({ owner: null, stored: null });

      await refresh();

      expect(await answers.findAnswer({ origin: MEMORY_SHARED_ORIGIN })).toBeNull();
    });
  });

  describe("given no worker has stored an answer for the LangWatchQL server", () => {
    /** @scenario "A run before any worker has answered is refused as not provisioned yet" */
    it("refuses lwql_not_provisioned as not provisioned yet, probing nothing", async () => {
      const { executor, run, probes } = serviceOver({ stored: null });

      expect(await run(SHARED)).toBe("lwql_not_provisioned");
      expect(executor.calls).toEqual([]);
      expect(probes()).toBe(0);
      expect(warnings).toContainEqual(expect.stringContaining("not provisioned yet"));
    });

    /** @scenario "The placement gate never probes, even in a process holding the system credential" */
    it("never calls the probe, though it would answer provisioned", async () => {
      const { run, probes } = serviceOver({
        owner: () => Promise.resolve("sql_store"),
        stored: null,
      });

      await run(SHARED);
      await run(SHARED);

      expect(probes()).toBe(0);
    });
  });

  describe("given a worker refreshing the answer", () => {
    /** @scenario "Each reconvergence check stores the access model's answer for its server" */
    it("stores the probe's answer for the server's origin and the next run reads it", async () => {
      const { run, refresh, answers, probes } = serviceOver({ stored: null });

      await refresh();

      expect(await answers.findAnswer({ origin: MEMORY_SHARED_ORIGIN })).toBe("provisioned");
      expect(await run(SHARED)).toBe("answered");
      expect(probes()).toBe(1);
    });

    /** @scenario "A probe that fails stores nothing and the check still completes" */
    it("throws to the check and stores nothing when the probe fails", async () => {
      const { run, refresh, answers } = serviceOver({
        owner: () => Promise.reject(new Error("connect ECONNREFUSED")),
        stored: null,
      });

      await expect(refresh()).rejects.toThrow("connect ECONNREFUSED");

      expect(await answers.findAnswer({ origin: MEMORY_SHARED_ORIGIN })).toBeNull();
      expect(await run(SHARED)).toBe("lwql_not_provisioned");
    });

    /** @scenario "A stored answer outlives the gap between two checks" */
    it("still answers one check interval later, and refuses once the answer lapsed", async () => {
      let now = 1_000_000;
      const { run, refresh } = serviceOver({
        stored: null,
        answers: MemoryLangWatchQLAccessModelAnswerRepository.create({ now: () => now }),
      });

      await refresh();
      now += LWQL_RECONVERGENCE_INTERVAL_MS + 60_000;
      expect(await run(SHARED)).toBe("answered");

      now += LWQL_ACCESS_MODEL_ANSWER_TTL_MS;
      expect(await run(SHARED)).toBe("lwql_not_provisioned");
    });
  });

  describe("given a self-hosted install whose ClickHouse has no access model", () => {
    /** @scenario "A self-hosted install answers only once LangWatchQL is enabled and provisioned" */
    it("refuses lwql_not_provisioned, then answers once provisioned and a worker stored it", async () => {
      let owner: LwqlAccessModelOwner = "none";
      const { executor, run, refresh, probes } = serviceOver({
        owner: () => Promise.resolve(owner),
        stored: null,
      });

      await refresh();
      expect(await run(SHARED)).toBe("lwql_not_provisioned");
      owner = "config_store";
      expect(await run(SHARED)).toBe("lwql_not_provisioned");
      expect(executor.calls).toEqual([]);

      await refresh();
      expect(await run(SHARED)).toBe("answered");
      expect(await run(SHARED)).toBe("answered");
      expect(probes()).toBe(2);
    });
  });
});
