/**
 * The placement gate every LangWatchQL run passes before any SQL runs (ADR-200).
 * Spec: specs/lwql/isolation.feature
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  createLangWatchQLService,
  EVERY_CATALOGUE_PERMISSION,
  RecordingLangWatchQLExecutor,
} from "../../app/__tests__/analytics.fixture.ts";
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
    service
      .execute({ project, protections: { catalogue: EVERY_CATALOGUE_PERMISSION }, sql: "SELECT 1" })
      .then(
        () => "answered",
        (error: unknown) =>
          error instanceof Error && "code" in error ? String(error.code) : String(error),
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
