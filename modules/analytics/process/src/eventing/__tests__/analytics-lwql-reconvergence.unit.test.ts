import type { JsonValue } from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
import type * as Observability from "@langwatch/observability";
/** Spec: specs/lwql/api.feature, modules/analytics/specs/analytics-lwql-project-keys.feature */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LwqlAppOwnedDrift } from "../../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import type { LwqlAccessModelOwner } from "../../rules/langwatch-ql-config-store.rules.ts";
import {
  LWQL_RECONVERGENCE_PROCESS_NAME,
  runLwqlReconvergence,
} from "../analytics-lwql-reconvergence.intent.ts";
import { buildLwqlReconvergence } from "../analytics-lwql-reconvergence.pipeline.ts";
import {
  LWQL_KEY_MAP_REFILL_MS,
  LWQL_RECONVERGENCE_INITIAL_STATE,
  LWQL_RECONVERGENCE_INTERVAL_MS,
  type LwqlReconvergenceState,
  lwqlReconvergenceSchema,
  lwqlReconvergenceStateSchema,
  lwqlReconvergenceWake,
} from "../analytics-lwql-reconvergence.process.ts";

const { logCalls } = vi.hoisted(() => ({
  logCalls: [] as { level: string; fields: unknown; message: unknown }[],
}));
vi.mock("@langwatch/observability", async (importActual) => {
  const actual = await importActual<typeof Observability>();
  const at =
    (level: string) =>
    (...args: unknown[]) => {
      logCalls.push({ level, fields: args.length > 1 ? args[0] : undefined, message: args.at(-1) });
    };
  return {
    ...actual,
    createLogger: () => ({
      info: at("info"),
      warn: at("warn"),
      error: at("error"),
      debug: at("debug"),
    }),
  };
});

const ALERT = "lwql provisioning failed creating ClickHouse objects";
const POSTGRES_ALERT = "lwql provisioning failed creating PostgreSQL objects";
const HOUR = 60 * 60_000;
const FIRST_SLOT = 1_700_000_000_000;
const healthy: LwqlAppOwnedDrift = { clickHouse: [], postgres: [], isKeyMapMissing: false };
const wakeOnce = { fillKeyMap: false };

function wake(state: LwqlReconvergenceState, at: number) {
  const reconverge = vi.fn((messageKey: string, payload: JsonValue) => ({
    messageKey,
    intentType: "reconverge",
    payload,
  }));
  const evolution = lwqlReconvergenceWake(state, {
    at,
    now: at,
    key: LWQL_RECONVERGENCE_PROCESS_NAME,
    projectId: "__global__",
    intent: intentAccessorOf({ reconverge }),
  });
  return { evolution, reconverge };
}

/** A ClickHouse whose objects a converge creates only once the named collection is mounted. */
function clickHouseWorld({ missing }: { missing: string[] }) {
  const world = {
    missing: new Set(missing),
    collectionMounted: false,
    ddlRuns: 0,
    async findDrift(): Promise<LwqlAppOwnedDrift> {
      const objects = [...world.missing];
      return {
        clickHouse: objects,
        postgres: [],
        isKeyMapMissing: objects.includes("api_key_tenants"),
      };
    },
    async convergeAppOwned(): Promise<void> {
      world.ddlRuns += 1;
      if (!world.collectionMounted) {
        throw Object.assign(new Error("Code: 669. DB::Exception: There is no named collection"), {
          code: "669",
          type: "NAMED_COLLECTION_DOESNT_EXIST",
        });
      }
      world.missing.clear();
    },
  };
  return world;
}

/** One worker's check over the world: nothing it holds is shared with any other worker. */
function workerOver(
  world: ReturnType<typeof clickHouseWorld>,
  overrides: Partial<Parameters<typeof runLwqlReconvergence>[0]> = {},
) {
  const converge = vi.fn(() => Promise.resolve());
  const fillKeyMap = vi.fn(() => Promise.resolve());
  const check = runLwqlReconvergence({
    probe: () => Promise.resolve("config_store"),
    converge,
    findDrift: () => world.findDrift(),
    convergeAppOwned: () => world.convergeAppOwned(),
    fillKeyMap,
    ...overrides,
  });
  return { check, converge, fillKeyMap };
}

beforeEach(() => {
  logCalls.length = 0;
});

describe("given the reconvergence check's schedule", () => {
  describe("when the fleet's one scheduled wake fires, slot after slot", () => {
    /** @scenario "The reconvergence check runs every 5 minutes with no end and no per-worker state" */
    it("asks for exactly one check per slot for a whole week, never giving up", () => {
      let state = LWQL_RECONVERGENCE_INITIAL_STATE;
      const keys = new Set<string>();
      const slots = (7 * 24 * 60 * 60_000) / LWQL_RECONVERGENCE_INTERVAL_MS;
      for (let slot = 0; slot < slots; slot++) {
        const at = FIRST_SLOT + slot * LWQL_RECONVERGENCE_INTERVAL_MS;
        const next = wake(state, at);
        expect(next.reconverge).toHaveBeenCalledTimes(1);
        keys.add(next.reconverge.mock.calls[0]?.[0] ?? "");
        state = next.evolution.state;
      }
      expect(keys.size).toBe(slots);
    });

    /** @scenario "The reconvergence check runs every 5 minutes with no end and no per-worker state" */
    it("gives two workers waking the same slot the same message key, so the outbox keeps one", () => {
      const a = wake(LWQL_RECONVERGENCE_INITIAL_STATE, FIRST_SLOT);
      const b = wake(LWQL_RECONVERGENCE_INITIAL_STATE, FIRST_SLOT);
      expect(a.reconverge.mock.calls[0]?.[0]).toBe(b.reconverge.mock.calls[0]?.[0]);
    });

    it("reads the state and payload the earlier boot-scoped watch stored", () => {
      const stored = { bootedAt: 1, nextAt: 2, delayMs: 5_000, elapsedMs: 0, gaveUp: true };
      expect(lwqlReconvergenceStateSchema.parse(stored)).toEqual({ keyMapFillAskedAt: null });
      expect(
        lwqlReconvergenceSchema.parse({ scheduledFor: 1, final: true, fillKeyMap: true }),
      ).toEqual({ scheduledFor: 1, fillKeyMap: true });
    });
  });

  describe("when deciding which checks also fill the key map", () => {
    /** @scenario "The reconvergence check fills the key-map rows a project lacks" */
    it("asks the first check and the first check a day after the last fill, and no other", () => {
      const fills: boolean[] = [];
      let state = LWQL_RECONVERGENCE_INITIAL_STATE;
      const slots = (LWQL_KEY_MAP_REFILL_MS / LWQL_RECONVERGENCE_INTERVAL_MS) * 2 + 1;
      for (let slot = 0; slot < slots; slot++) {
        const next = wake(state, FIRST_SLOT + slot * LWQL_RECONVERGENCE_INTERVAL_MS);
        fills.push(lwqlReconvergenceSchema.parse(next.reconverge.mock.calls[0]?.[1]).fillKeyMap);
        state = next.evolution.state;
      }
      const filledAt = fills.flatMap((fill, slot) => (fill ? [slot] : []));
      const perDay = LWQL_KEY_MAP_REFILL_MS / LWQL_RECONVERGENCE_INTERVAL_MS;
      expect(filledAt).toEqual([0, perDay, perDay * 2]);
    });
  });
});

describe("given a check over the app-owned objects", () => {
  describe("when every app-owned object is in place", () => {
    /** @scenario "The reconvergence check converges nothing while every app-owned LangWatchQL object is in place" */
    it("runs no DDL and converges nothing", async () => {
      const world = clickHouseWorld({ missing: [] });
      const convergeAppOwned = vi.fn(() => Promise.resolve());
      const { check, converge } = workerOver(world, { convergeAppOwned });

      for (let checks = 0; checks < 3; checks++) await check(wakeOnce);

      expect(convergeAppOwned).not.toHaveBeenCalled();
      expect(converge).not.toHaveBeenCalled();
      expect(world.ddlRuns).toBe(0);
    });
  });

  describe("when an engine table is missing", () => {
    /** @scenario "The reconvergence check converges the app-owned LangWatchQL objects it finds missing" */
    it("converges with the drift it read and leaves the access model to the config store", async () => {
      const drift: LwqlAppOwnedDrift = {
        clickHouse: ["agents_pg"],
        postgres: [],
        isKeyMapMissing: false,
      };
      const convergeAppOwned = vi.fn((_drift: LwqlAppOwnedDrift) => Promise.resolve());
      const converge = vi.fn(() => Promise.resolve());
      await runLwqlReconvergence({
        probe: () => Promise.resolve("config_store"),
        converge,
        findDrift: () => Promise.resolve(drift),
        convergeAppOwned,
        fillKeyMap: () => Promise.resolve(),
      })(wakeOnce);

      expect(convergeAppOwned).toHaveBeenCalledWith(drift);
      expect(converge).not.toHaveBeenCalled();
    });

    /** @scenario "The reconvergence check converges the app-owned LangWatchQL objects it finds missing" */
    it("converges nothing when ClickHouse cannot be read, and checks again next time", async () => {
      const convergeAppOwned = vi.fn(() => Promise.resolve());
      await runLwqlReconvergence({
        probe: () => Promise.resolve("config_store"),
        converge: () => Promise.resolve(),
        findDrift: () => Promise.reject(new Error("ECONNREFUSED")),
        convergeAppOwned,
        fillKeyMap: () => Promise.resolve(),
      })(wakeOnce);

      expect(convergeAppOwned).not.toHaveBeenCalled();
      expect(logCalls.map((call) => call.level)).not.toContain("error");
    });
  });

  describe("when the named collection is absent for a while and then mounted", () => {
    /** @scenario "The reconvergence check runs every 5 minutes with no end and no per-worker state" */
    it("converges on whichever worker checks after it appears, with no state between workers", async () => {
      const world = clickHouseWorld({ missing: ["agents_pg", "agents"] });
      const workers = [workerOver(world), workerOver(world), workerOver(world)];

      for (const worker of workers.slice(0, 2)) await worker.check(wakeOnce);
      expect(world.missing.size).toBe(2);

      world.collectionMounted = true;
      await workers[2]?.check(wakeOnce);
      expect(world.missing.size).toBe(0);

      const runsBefore = world.ddlRuns;
      for (const worker of workers) await worker.check(wakeOnce);
      expect(world.ddlRuns).toBe(runsBefore);
    });

    /** @scenario "A failed converge is retried by the next check and alerts once per change of failure" */
    it("logs the alert at error on the first failure and on a change, and warns while it repeats", async () => {
      const world = clickHouseWorld({ missing: ["agents_pg"] });
      const { check } = workerOver(world);
      const alerts = () => logCalls.filter((call) => call.level === "error");

      for (let checks = 0; checks < 4; checks++) {
        await expect(check(wakeOnce)).resolves.toBeUndefined();
      }
      expect(alerts().map((call) => call.message)).toEqual([ALERT]);
      expect(logCalls.filter((call) => call.level === "warn").length).toBeGreaterThanOrEqual(3);

      world.convergeAppOwned = () => Promise.reject(new Error("Timeout error."));
      await check(wakeOnce);
      expect(alerts()).toHaveLength(2);
    });

    /** @scenario "A failed converge is retried by the next check and alerts once per change of failure" */
    it("carries a stable error_signature on the alert line", async () => {
      const { check } = workerOver(clickHouseWorld({ missing: ["agents_pg"] }));
      await check(wakeOnce);

      expect(logCalls.find((call) => call.level === "error")).toMatchObject({
        message: ALERT,
        fields: {
          error_signature: "669:NAMED_COLLECTION_DOESNT_EXIST:NAMED_COLLECTION_DOESNT_EXIST",
        },
      });
    });

    /** @scenario "A failed converge is retried by the next check and alerts once per change of failure" */
    it("alerts again on a failure after a check that found nothing to converge", async () => {
      const world = clickHouseWorld({ missing: ["agents_pg"] });
      const { check } = workerOver(world);
      const alerts = () => logCalls.filter((call) => call.level === "error");

      await check(wakeOnce);
      const missing = [...world.missing];
      world.missing.clear();
      await check(wakeOnce);
      for (const name of missing) world.missing.add(name);
      await check(wakeOnce);

      expect(alerts()).toHaveLength(2);
    });

    /** @scenario "A failed converge is retried by the next check and alerts once per change of failure" */
    it("alerts again when the same failure has gone an hour without an error-level line", async () => {
      let now = FIRST_SLOT;
      const { check } = workerOver(clickHouseWorld({ missing: ["agents_pg"] }), {
        now: () => now,
      });
      const alerts = () => logCalls.filter((call) => call.level === "error");

      for (; now < FIRST_SLOT + HOUR; now += LWQL_RECONVERGENCE_INTERVAL_MS) await check(wakeOnce);
      expect(alerts()).toHaveLength(1);

      await check(wakeOnce);
      expect(alerts()).toHaveLength(2);
    });
  });

  describe("when PostgreSQL refuses its half", () => {
    const refusal = () =>
      Object.assign(new Error("permission denied"), { code: "P2010", meta: { code: "42501" } });
    const gap = { view: "lwql_agents", absent: true };

    /** @scenario "A failed converge is retried by the next check and alerts once per change of failure" */
    it("alerts with the PostgreSQL message and its SQLSTATE, and still converges ClickHouse", async () => {
      const drift: LwqlAppOwnedDrift = {
        clickHouse: ["agents_pg"],
        postgres: [gap],
        isKeyMapMissing: false,
      };
      const converged: LwqlAppOwnedDrift[] = [];
      await runLwqlReconvergence({
        probe: () => Promise.resolve("config_store"),
        converge: () => Promise.resolve(),
        findDrift: () => Promise.resolve(drift),
        convergeAppOwned: async (half) => {
          if (half.clickHouse.length === 0) throw refusal();
          converged.push(half);
        },
        fillKeyMap: () => Promise.resolve(),
      })(wakeOnce);

      expect(logCalls.filter((call) => call.level === "error")).toEqual([
        expect.objectContaining({
          message: POSTGRES_ALERT,
          fields: expect.objectContaining({
            error_signature: "P2010:42501:Error",
            code: "P2010",
            sqlState: "42501",
          }),
        }),
      ]);
      expect(converged).toEqual([
        { clickHouse: ["agents_pg"], postgres: [], isKeyMapMissing: false },
      ]);
    });

    /** @scenario "A failed converge is retried by the next check and alerts once per change of failure" */
    it("neither converges nor clears the alert while PostgreSQL cannot be read", async () => {
      const reads: LwqlAppOwnedDrift["postgres"][] = [[gap], "unknown", [gap]];
      const convergeAppOwned = vi.fn((_half: LwqlAppOwnedDrift) => Promise.reject(refusal()));
      const check = runLwqlReconvergence({
        probe: () => Promise.resolve("config_store"),
        converge: () => Promise.resolve(),
        findDrift: () =>
          Promise.resolve({
            clickHouse: [],
            postgres: reads.shift() ?? [],
            isKeyMapMissing: false,
          }),
        convergeAppOwned,
        fillKeyMap: () => Promise.resolve(),
      });

      for (let checks = 0; checks < 3; checks++) await check(wakeOnce);

      expect(convergeAppOwned).toHaveBeenCalledTimes(2);
      expect(logCalls.filter((call) => call.level === "error")).toHaveLength(1);
    });
  });

  describe("when the key map itself is missing", () => {
    /** @scenario "The reconvergence check fills the key-map rows a project lacks" */
    it("fills only once a converge has repaired it, then on the next asked-for fill", async () => {
      const world = clickHouseWorld({ missing: ["api_key_tenants"] });
      const { check, fillKeyMap } = workerOver(world);

      await check({ fillKeyMap: true });
      expect(fillKeyMap).not.toHaveBeenCalled();

      world.collectionMounted = true;
      await check(wakeOnce);
      expect(fillKeyMap).toHaveBeenCalledTimes(1);

      await check(wakeOnce);
      expect(fillKeyMap).toHaveBeenCalledTimes(1);
      await check({ fillKeyMap: true });
      expect(fillKeyMap).toHaveBeenCalledTimes(2);
    });

    /** @scenario "The reconvergence check fills the key-map rows a project lacks" */
    it("still probes when the fill fails, then fails the check so the outbox delivers it again", async () => {
      const probe = vi.fn(() => Promise.resolve<LwqlAccessModelOwner>("sql_store"));
      const refused = new Error("ECONNREFUSED");
      const check = runLwqlReconvergence({
        probe,
        converge: () => Promise.resolve(),
        findDrift: () => Promise.resolve(healthy),
        convergeAppOwned: () => Promise.resolve(),
        fillKeyMap: () => Promise.reject(refused),
      });

      await expect(check({ fillKeyMap: true })).rejects.toMatchObject({ cause: refused });
      expect(probe).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the outbox delivers a check again after its fill failed", () => {
    function redelivered(fillKeyMap: () => Promise<unknown>) {
      const deps = {
        probe: vi.fn(() => Promise.resolve<LwqlAccessModelOwner>("none")),
        converge: vi.fn(() => Promise.resolve()),
        findDrift: vi.fn(() =>
          Promise.resolve<LwqlAppOwnedDrift>({
            clickHouse: ["agents_pg"],
            postgres: [],
            isKeyMapMissing: false,
          }),
        ),
        convergeAppOwned: vi.fn(() => Promise.resolve()),
        fillKeyMap: vi.fn(fillKeyMap),
      };
      return { deps, done: runLwqlReconvergence(deps)(wakeOnce, { attempt: 2 }) };
    }

    /** @scenario "The reconvergence check fills the key-map rows a project lacks" */
    it("only fills, leaving drift, converges and the probe to the next wake's check", async () => {
      const { deps, done } = redelivered(() => Promise.resolve());
      await done;

      expect(deps.fillKeyMap).toHaveBeenCalledTimes(1);
      expect(deps.findDrift).not.toHaveBeenCalled();
      expect(deps.convergeAppOwned).not.toHaveBeenCalled();
      expect(deps.probe).not.toHaveBeenCalled();
      expect(deps.converge).not.toHaveBeenCalled();
    });

    /** @scenario "The reconvergence check fills the key-map rows a project lacks" */
    it("fails again with the ClickHouse error as the cause when the fill fails again", async () => {
      const refused = new Error("ECONNREFUSED");
      const { deps, done } = redelivered(() => Promise.reject(refused));

      await expect(done).rejects.toMatchObject({ cause: refused });
      expect(deps.probe).not.toHaveBeenCalled();
    });
  });
});

describe("given the pipeline's check, delivered by its outbox", () => {
  /** The built pipeline over an app whose first `failures` fills fail; drift reads in turn. */
  function deliveredChecks({
    failures,
    drifts = [],
  }: {
    failures: number;
    drifts?: LwqlAppOwnedDrift[];
  }) {
    const fill = { failuresLeft: failures, runs: 0 };
    const processManager = buildLwqlReconvergence({
      app: {
        probeLwqlAccessModelOwner: () => Promise.resolve("config_store"),
        convergeLwqlAccessModel: () => Promise.resolve(),
        findLwqlAppOwnedDrift: () => Promise.resolve(drifts.shift() ?? healthy),
        convergeLwqlAppOwnedObjects: () => Promise.resolve(),
        syncLwqlKeyMapRow: () => Promise.resolve(),
        fillLwqlProjectKeys: () => {
          fill.runs += 1;
          if (fill.failuresLeft === 0) return Promise.resolve({});
          fill.failuresLeft -= 1;
          return Promise.reject(new Error("ECONNREFUSED"));
        },
      },
    }).processManagers.get(LWQL_RECONVERGENCE_PROCESS_NAME);
    const reconverge = processManager?.config.intents.reconverge;
    const outbox = processManager?.config.outbox;
    if (!reconverge || !outbox?.maxAttempts || !outbox.retryDelayMs) {
      throw new Error("the reconvergence pipeline declares no retrying reconverge intent");
    }
    const { run } = reconverge;
    const { maxAttempts, retryDelayMs } = outbox;

    /** One wake's check, delivered again after each failure as the outbox does; its deliveries. */
    async function deliver(payload: JsonValue): Promise<number> {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const delivery = {
          processName: LWQL_RECONVERGENCE_PROCESS_NAME,
          projectId: "__global__",
          processKey: LWQL_RECONVERGENCE_PROCESS_NAME,
          tenantId: "__global__",
          messageKey: "reconverge",
          attempt,
        };
        const settled = await run(payload, delivery).then(
          () => true,
          () => false,
        );
        if (settled) return attempt;
      }
      throw new Error("the check died after every delivery failed");
    }
    return { fill, deliver, maxAttempts, retryDelayMs };
  }

  describe("when an asked-for fill fails", () => {
    /** @scenario "The reconvergence check fills the key-map rows a project lacks" */
    it("delivers the check again until a fill succeeds", async () => {
      const { fill, deliver } = deliveredChecks({ failures: 2 });

      expect(await deliver({ scheduledFor: FIRST_SLOT, fillKeyMap: true })).toBe(3);
      expect(fill.runs).toBe(3);
    });

    /** @scenario "The reconvergence check fills the key-map rows a project lacks" */
    it("backs off from 5 minutes to every 2 hours, and gives up before the next day's ask", () => {
      const { maxAttempts, retryDelayMs } = deliveredChecks({ failures: 0 });
      const delays = Array.from({ length: maxAttempts - 1 }, (_, i) =>
        retryDelayMs({ attempt: i + 1 }),
      );
      const lastDeliveryAfterMs = delays.reduce((sum, delay) => sum + delay, 0);

      expect(delays.slice(0, 3)).toEqual([5, 10, 20].map((minutes) => minutes * 60_000));
      expect(Math.max(...delays)).toBe(2 * HOUR);
      expect(lastDeliveryAfterMs).toBeLessThan(LWQL_KEY_MAP_REFILL_MS);
      expect(lastDeliveryAfterMs + 2 * HOUR).toBeGreaterThan(LWQL_KEY_MAP_REFILL_MS);
    });

    /** @scenario "The reconvergence check fills the key-map rows a project lacks" */
    it("asks for no other fill after one succeeds until a day after the ask", async () => {
      const { fill, deliver } = deliveredChecks({ failures: 3 });
      const perDay = LWQL_KEY_MAP_REFILL_MS / LWQL_RECONVERGENCE_INTERVAL_MS;
      let state = LWQL_RECONVERGENCE_INITIAL_STATE;
      const runsAfter: number[] = [];
      for (let slot = 0; slot <= perDay; slot++) {
        const next = wake(state, FIRST_SLOT + slot * LWQL_RECONVERGENCE_INTERVAL_MS);
        await deliver(next.reconverge.mock.calls[0]?.[1] ?? null);
        runsAfter.push(fill.runs);
        state = next.evolution.state;
      }

      expect(runsAfter[0]).toBe(4);
      expect(runsAfter[perDay - 1]).toBe(4);
      expect(runsAfter[perDay]).toBe(5);
    });
  });

  describe("when the fill after a converge that repaired the key map fails", () => {
    /** @scenario "The reconvergence check fills the key-map rows a project lacks" */
    it("fills on the next delivery, though the key map now reads as present", async () => {
      const repaired: LwqlAppOwnedDrift = {
        clickHouse: ["api_key_tenants"],
        postgres: [],
        isKeyMapMissing: true,
      };
      const { fill, deliver } = deliveredChecks({ failures: 1, drifts: [repaired] });

      expect(await deliver({ scheduledFor: FIRST_SLOT, fillKeyMap: false })).toBe(2);
      expect(fill.runs).toBe(2);
    });
  });
});

describe("given the SQL-mode owner probe", () => {
  const run = (owner: LwqlAccessModelOwner | Error) => {
    const converge = vi.fn(() => Promise.resolve());
    const probe = () => (owner instanceof Error ? Promise.reject(owner) : Promise.resolve(owner));
    return {
      converge,
      done: runLwqlReconvergence({
        probe,
        converge,
        findDrift: () => Promise.resolve(healthy),
        convergeAppOwned: () => Promise.resolve(),
        fillKeyMap: () => Promise.resolve(),
      })(wakeOnce),
    };
  };

  /** @scenario "The app re-provisions once the ClickHouse config store releases the LangWatchQL access model" */
  it("re-provisions only once neither store owns the model, and never on a probe error", async () => {
    for (const owner of ["config_store", "sql_store", new Error("ECONNREFUSED")] as const) {
      const { converge, done } = run(owner);
      await done;
      expect(converge).not.toHaveBeenCalled();
    }
    const released = run("none");
    await released.done;
    expect(released.converge).toHaveBeenCalledTimes(1);
  });

  /** @scenario "A re-provision in flight finishes before the worker lets the app close" */
  it("resolves only once the re-provision has finished", async () => {
    const order: string[] = [];
    const converge = () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          order.push("converged");
          resolve();
        }, 5);
      });
    await runLwqlReconvergence({
      probe: () => Promise.resolve("none"),
      converge,
      findDrift: () => Promise.resolve(healthy),
      convergeAppOwned: () => Promise.resolve(),
      fillKeyMap: () => Promise.resolve(),
    })(wakeOnce);
    order.push("intent resolved");
    expect(order).toEqual(["converged", "intent resolved"]);
  });
});
