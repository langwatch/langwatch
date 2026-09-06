import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLIENTS_PER_PROCESS,
  DEFAULT_SERVER_MAX_CONCURRENT_QUERIES,
  DEFAULT_SERVER_NODES,
  deriveFleetPoolCeiling,
  FALLBACK_POOL_SIZE,
  MAX_POOL_SIZE,
  poolSizingFromEnv,
  resolvePoolSize,
} from "../pool";

describe("deriveFleetPoolCeiling", () => {
  describe("given the fleet size is unknown", () => {
    describe("when a ceiling is derived", () => {
      it.each([
        ["undefined replicas", undefined],
        ["zero replicas", 0],
        ["negative replicas", -3],
        ["a non-finite replica count", Number.NaN],
      ])("cannot derive a ceiling from %s", (_label, replicas) => {
        expect(deriveFleetPoolCeiling({ replicas })).toBeNull();
      });
    });
  });

  describe("given a fractional fleet description", () => {
    describe("when a ceiling is derived", () => {
      it("cannot derive a ceiling from fractional replicas", () => {
        expect(deriveFleetPoolCeiling({ replicas: 2.5 })).toBeNull();
      });

      it("falls back to the default client count rather than accept a fraction", () => {
        // A fractional clientsPerProcess must not inflate the derived
        // ceiling - it previously did, since floor((300*0.7)/(10*0.5)) = 42
        // is *more* permissive than any real client count would allow.
        const withFraction = deriveFleetPoolCeiling({
          replicas: 10,
          clientsPerProcess: 0.5,
        });
        const withDefault = deriveFleetPoolCeiling({ replicas: 10 });

        expect(withFraction).toBe(withDefault);
      });
    });
  });

  describe("given the fleet size is known", () => {
    describe("when a ceiling is derived", () => {
      it("keeps every pool on every pod inside the server's budget", () => {
        const replicas = 10;
        const clientsPerProcess = 2;

        const ceiling = deriveFleetPoolCeiling({ replicas, clientsPerProcess });

        expect(ceiling).toBe(10);
        expect(ceiling! * replicas * clientsPerProcess).toBeLessThanOrEqual(
          DEFAULT_SERVER_MAX_CONCURRENT_QUERIES,
        );
      });

      it("grows with the server's budget", () => {
        expect(
          deriveFleetPoolCeiling({
            replicas: 10,
            serverMaxConcurrentQueries: 1000,
          }),
        ).toBe(70);
      });

      it("gives a process holding one client twice the pool", () => {
        const two = deriveFleetPoolCeiling({
          replicas: 10,
          clientsPerProcess: 2,
        });
        const one = deriveFleetPoolCeiling({
          replicas: 10,
          clientsPerProcess: 1,
        });

        expect(one).toBe(21);
        expect(two).toBe(10);
        expect(one!).toBeGreaterThan(two!);
      });

      it("shrinks as the fleet grows", () => {
        const small = deriveFleetPoolCeiling({ replicas: 4 })!;
        const large = deriveFleetPoolCeiling({ replicas: 40 })!;

        expect(large).toBeLessThan(small);
      });

      it("never derives below a single usable connection", () => {
        expect(deriveFleetPoolCeiling({ replicas: 100_000 })).toBe(1);
      });

      it("never derives above the hard cap", () => {
        expect(
          deriveFleetPoolCeiling({
            replicas: 1,
            clientsPerProcess: 1,
            serverMaxConcurrentQueries: 10_000_000,
          }),
        ).toBe(MAX_POOL_SIZE);
      });

      it("reproduces the sizing that broke production", () => {
        // 10 worker pods x 2 clients x a fixed 64 against a 300-query ceiling.
        const fixedDefault = 64;
        const ceiling = deriveFleetPoolCeiling({ replicas: 10 })!;

        expect(fixedDefault * 10 * 2).toBeGreaterThan(
          DEFAULT_SERVER_MAX_CONCURRENT_QUERIES,
        );
        expect(ceiling).toBeLessThan(fixedDefault);
      });
    });
  });
});

describe("resolvePoolSize", () => {
  describe("given no inputs at all", () => {
    describe("when the size is resolved", () => {
      it("falls back rather than guessing a fleet size", () => {
        const decision = resolvePoolSize();

        expect(decision.size).toBe(FALLBACK_POOL_SIZE);
        expect(decision.source).toBe("fallback");
        expect(decision.derivedCeiling).toBeNull();
        expect(decision.exceedsBudget).toBe(false);
      });
    });
  });

  describe("given the fleet size is known", () => {
    describe("when the size is resolved", () => {
      it("derives the size", () => {
        const decision = resolvePoolSize({ replicas: 10 });

        expect(decision).toMatchObject({
          size: 21,
          source: "derived",
          derivedCeiling: 21,
          exceedsBudget: false,
        });
      });
    });
  });

  describe("given a fleet so large the budget cannot afford one connection", () => {
    describe("when the size is resolved", () => {
      it("still reports the budget as exceeded", () => {
        // 301 replicas x 1 client x the floored minimum of 1 is 301
        // connections against the default 300-query ceiling - the floor that
        // keeps the *ceiling* at a usable 1 must not also hide that the real
        // budget is already gone.
        const decision = resolvePoolSize({ replicas: 301 });

        expect(decision.size).toBe(1);
        expect(decision.exceedsBudget).toBe(true);
      });
    });
  });

  describe("given an operator override", () => {
    describe("when the size is resolved", () => {
      it("wins over the derived size", () => {
        const decision = resolvePoolSize({ override: 40, replicas: 10 });

        expect(decision.size).toBe(40);
        expect(decision.source).toBe("override");
      });

      it("reports a conflict with the fleet budget instead of hiding it", () => {
        const decision = resolvePoolSize({ override: 40, replicas: 10 });

        expect(decision.exceedsBudget).toBe(true);
        expect(decision.derivedCeiling).toBe(21);
      });

      it("raises no conflict when it fits the budget", () => {
        const decision = resolvePoolSize({ override: 8, replicas: 10 });

        expect(decision.exceedsBudget).toBe(false);
      });

      it("still reports the ceiling when nothing conflicts", () => {
        expect(
          resolvePoolSize({ override: 8, replicas: 10 }).derivedCeiling,
        ).toBe(21);
      });
    });

    describe("when the override is unusable", () => {
      it.each([
        ["zero", 0],
        ["negative", -5],
        ["fractional", 2.5],
        ["above the hard cap", 5000],
        ["not a number", Number.NaN],
      ])("ignores an unusable override (%s)", (_label, override) => {
        const decision = resolvePoolSize({ override });

        expect(decision.size).toBe(FALLBACK_POOL_SIZE);
        expect(decision.rejectedOverride).toBe(override);
      });

      it("falls through to the derived size when it is unusable", () => {
        const decision = resolvePoolSize({ override: 0, replicas: 10 });

        expect(decision.size).toBe(21);
        expect(decision.source).toBe("derived");
        expect(decision.rejectedOverride).toBe(0);
      });
    });
  });
});

describe("poolSizingFromEnv", () => {
  describe("given an empty environment", () => {
    describe("when the inputs are read", () => {
      it("supplies nothing rather than inventing defaults", () => {
        expect(poolSizingFromEnv({})).toEqual({
          override: undefined,
          replicas: undefined,
          serverMaxConcurrentQueries: undefined,
          serverNodes: undefined,
          clientsPerProcess: undefined,
        });
      });

      it("treats an empty string as unset", () => {
        expect(
          poolSizingFromEnv({ CLICKHOUSE_CLIENT_REPLICAS: "" }).replicas,
        ).toBeUndefined();
      });
    });
  });

  describe("given a populated environment", () => {
    describe("when the inputs are read", () => {
      it("reads every knob", () => {
        expect(
          poolSizingFromEnv({
            CLICKHOUSE_MAX_OPEN_CONNECTIONS: "40",
            CLICKHOUSE_CLIENT_REPLICAS: "10",
            CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES: "500",
            CLICKHOUSE_SERVER_NODES: "3",
            CLICKHOUSE_CLIENTS_PER_PROCESS: "1",
          }),
        ).toEqual({
          override: 40,
          replicas: 10,
          serverMaxConcurrentQueries: 500,
          serverNodes: 3,
          clientsPerProcess: 1,
        });
      });

      it("surfaces a non-numeric value as NaN so the resolver rejects it", () => {
        const input = poolSizingFromEnv({
          CLICKHOUSE_MAX_OPEN_CONNECTIONS: "lots",
        });

        expect(input.override).toBeNaN();
        expect(resolvePoolSize(input).size).toBe(FALLBACK_POOL_SIZE);
      });
    });
  });

  describe("given the environment describes the production fleet", () => {
    describe("when the size is resolved", () => {
      it("resolves a size that fits the server's budget", () => {
        const decision = resolvePoolSize(
          poolSizingFromEnv({ CLICKHOUSE_CLIENT_REPLICAS: "10" }),
        );

        expect(
          decision.size * 10 * DEFAULT_CLIENTS_PER_PROCESS,
        ).toBeLessThanOrEqual(DEFAULT_SERVER_MAX_CONCURRENT_QUERIES);
      });
    });
  });
});

describe("cluster-wide budget derivation", () => {
  // Prod on 2026-08-18: 3 ClickHouse nodes at max_concurrent_queries=300 each,
  // CLICKHOUSE_CLIENT_REPLICAS=25, CLICKHOUSE_MAX_OPEN_CONNECTIONS=20. Reading
  // 300 as the whole cluster's budget derived a ceiling of 8, so the override
  // of 20 logged "lets this fleet exceed the server's concurrent-query budget"
  // continuously while ClickHouse ran at ~22% utilisation and rejected nothing.
  const PROD = {
    replicas: 25,
    serverMaxConcurrentQueries: 300,
    serverNodes: 3,
    override: 20,
  } as const;

  describe("given a cluster of several nodes", () => {
    describe("when a ceiling is derived", () => {
      /** @scenario "The budget counts every node the cluster runs" */
      it("divides the whole cluster's capacity, not one node's", () => {
        expect(deriveFleetPoolCeiling(PROD)).toBe(25);
      });

      /** @scenario "The budget counts every node the cluster runs" */
      it("allows a larger bound as nodes are added", () => {
        const oneNode = deriveFleetPoolCeiling({ ...PROD, serverNodes: 1 })!;
        const threeNodes = deriveFleetPoolCeiling(PROD)!;

        expect(oneNode).toBe(8);
        expect(threeNodes).toBeGreaterThan(oneNode * 3);
      });

      /** @scenario "The budget counts every node the cluster runs" */
      it("keeps the whole fleet inside the cluster's real budget", () => {
        const ceiling = deriveFleetPoolCeiling(PROD)!;

        expect(ceiling * PROD.replicas).toBeLessThanOrEqual(
          PROD.serverMaxConcurrentQueries * PROD.serverNodes,
        );
      });
    });
  });

  describe("given a deployment that does not say how many nodes it has", () => {
    describe("when a ceiling is derived", () => {
      /** @scenario "A single-node cluster is sized exactly as before" */
      it("assumes one node", () => {
        expect(DEFAULT_SERVER_NODES).toBe(1);
        expect(deriveFleetPoolCeiling({ replicas: 10 })).toBe(
          deriveFleetPoolCeiling({ replicas: 10, serverNodes: 1 }),
        );
      });

      /** @scenario "A single-node cluster is sized exactly as before" */
      it("derives what it derived before the cluster size was considered", () => {
        // floor(300 * 0.7 / 10) — the pre-change arithmetic, unchanged.
        expect(deriveFleetPoolCeiling({ replicas: 10 })).toBe(21);
      });

      /** @scenario "A single-node cluster is sized exactly as before" */
      it("refuses a node count that cannot exist rather than inflating the budget", () => {
        for (const serverNodes of [0, -3, 2.5, Number.NaN]) {
          expect(deriveFleetPoolCeiling({ replicas: 10, serverNodes })).toBe(
            deriveFleetPoolCeiling({ replicas: 10 }),
          );
        }
      });
    });
  });

  describe("given an operator override and a multi-node cluster", () => {
    describe("when the size is resolved", () => {
      /** @scenario "An override within the corrected budget is not reported as excessive" */
      it("stops calling the production override excessive", () => {
        const decision = resolvePoolSize(PROD);

        expect(decision.size).toBe(PROD.override);
        expect(decision.source).toBe("override");
        expect(decision.exceedsBudget).toBe(false);
      });

      /** @scenario "An operator override beyond the cluster budget is reported, not silently obeyed" */
      it("still reports an override the whole cluster cannot afford", () => {
        const decision = resolvePoolSize({ ...PROD, override: 200 });

        expect(decision.size).toBe(200);
        expect(decision.exceedsBudget).toBe(true);
        expect(decision.derivedCeiling).toBe(25);
      });

      /** @scenario "An operator override beyond the cluster budget is reported, not silently obeyed" */
      it("reported that same override as excessive before the cluster was counted", () => {
        const decision = resolvePoolSize({ ...PROD, serverNodes: 1 });

        expect(decision.exceedsBudget).toBe(true);
        expect(decision.derivedCeiling).toBe(8);
      });
    });
  });
});
