import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

const LANGWATCH_ENDPOINT =
  process.env.LANGWATCH_ENDPOINT ?? "http://localhost:5560";

const LANGWATCH_API_KEY = process.env.LANGWATCH_API_KEY;

/**
 * Stress tests for scenario set limit enforcement (R3, R4, R5, R6, R7).
 *
 * These hit the real /api/scenario-events endpoint with raw fetch.
 * Free plan allows 3 distinct scenario sets; the 4th must be blocked with 403.
 * Adding runs to an existing set must always succeed (201).
 * Non-RUN_STARTED events pass through without limit checks.
 *
 * Run with: pnpm test:stress
 * Requires: LANGWATCH_API_KEY env var and a running instance.
 */
describe("Scenario set limit enforcement", () => {
  let apiKey: string;
  const prefix = nanoid(8);

  function setId(n: number): string {
    return `stress-set-${prefix}-${n}`;
  }

  function scenarioId(label: string): string {
    return `stress-scen-${prefix}-${label}`;
  }

  function runId(label: string): string {
    return `stress-run-${prefix}-${label}`;
  }

  function batchId(label: string): string {
    return `stress-batch-${prefix}-${label}`;
  }

  async function sendRunStarted(
    scenarioSetId: string,
    opts: {
      scenarioId: string;
      scenarioRunId: string;
      batchRunId: string;
      name?: string;
    },
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(
      `${LANGWATCH_ENDPOINT}/api/scenario-events`,
      {
        method: "POST",
        headers: {
          "X-Auth-Token": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "SCENARIO_RUN_STARTED",
          timestamp: Date.now(),
          scenarioId: opts.scenarioId,
          scenarioRunId: opts.scenarioRunId,
          batchRunId: opts.batchRunId,
          scenarioSetId,
          metadata: { name: opts.name ?? `Stress test ${scenarioSetId}` },
        }),
      },
    );

    const body = (await response.json()) as Record<string, unknown>;
    return { status: response.status, body };
  }

  async function sendMessageSnapshot(
    scenarioSetId: string,
    opts: {
      scenarioId: string;
      scenarioRunId: string;
      batchRunId: string;
    },
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(
      `${LANGWATCH_ENDPOINT}/api/scenario-events`,
      {
        method: "POST",
        headers: {
          "X-Auth-Token": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "SCENARIO_MESSAGE_SNAPSHOT",
          timestamp: Date.now(),
          scenarioId: opts.scenarioId,
          scenarioRunId: opts.scenarioRunId,
          batchRunId: opts.batchRunId,
          scenarioSetId,
          messages: [{ role: "user", content: "hello from stress test" }],
        }),
      },
    );

    const body = (await response.json()) as Record<string, unknown>;
    return { status: response.status, body };
  }

  beforeAll(() => {
    if (!LANGWATCH_API_KEY) {
      throw new Error(
        "LANGWATCH_API_KEY is not set -- stress tests require a live instance",
      );
    }
    apiKey = LANGWATCH_API_KEY;
  });

  describe("when creating scenario sets up to the free-plan limit", () => {
    it("R3: allows the first 3 distinct sets and blocks the 4th with 403", async () => {
      // Create 3 distinct scenario sets -- all should succeed (201)
      for (let i = 1; i <= 3; i++) {
        const { status, body } = await sendRunStarted(setId(i), {
          scenarioId: scenarioId(`set${i}`),
          scenarioRunId: runId(`set${i}-run1`),
          batchRunId: batchId(`set${i}`),
          name: `Stress Set ${i}`,
        });

        expect(status, `scenario set ${i} should return 201`).toBe(201);
        expect(body).toHaveProperty("success", true);
      }

      // 4th distinct set -- should be blocked
      const { status, body } = await sendRunStarted(setId(4), {
        scenarioId: scenarioId("set4"),
        scenarioRunId: runId("set4-run1"),
        batchRunId: batchId("set4"),
        name: "Stress Set 4",
      });

      expect(status, "4th scenario set should return 403").toBe(403);
      expect(body).toHaveProperty("error", "scenario_set_limit_exceeded");
      expect(body).toHaveProperty("limitType", "scenarioSets");
    });

    it("R6: 403 response body has the structured error shape", async () => {
      // We are already at the limit from R3, so a new set should be blocked
      const { status, body } = await sendRunStarted(setId(5), {
        scenarioId: scenarioId("set5"),
        scenarioRunId: runId("set5-run1"),
        batchRunId: batchId("set5"),
        name: "Stress Set 5",
      });

      expect(status).toBe(403);
      expect(body).toEqual(
        expect.objectContaining({
          error: "scenario_set_limit_exceeded",
          limitType: "scenarioSets",
          current: expect.any(Number),
          max: expect.any(Number),
          message: expect.any(String),
        }),
      );
      expect(body.current).toBeGreaterThanOrEqual(body.max as number);
    });
  });

  describe("when adding runs to an existing set at the limit", () => {
    it("R4: sends RUN_STARTED to an existing set and gets 201", async () => {
      // setId(1) was created in R3 -- adding a new run must succeed
      const { status, body } = await sendRunStarted(setId(1), {
        scenarioId: scenarioId("extra"),
        scenarioRunId: runId("set1-run2"),
        batchRunId: batchId("set1-b"),
        name: "Extra run in Set 1",
      });

      expect(status, "existing set run should return 201").toBe(201);
      expect(body).toHaveProperty("success", true);
    });

    it("R7: sends 5+ runs within a single set and all succeed (201)", async () => {
      // Send 5 more runs into setId(1) -- every one should succeed
      for (let i = 3; i <= 7; i++) {
        const { status, body } = await sendRunStarted(setId(1), {
          scenarioId: scenarioId(`bulk-${i}`),
          scenarioRunId: runId(`set1-run${i}`),
          batchRunId: batchId("set1-bulk"),
          name: `Bulk run ${i} in Set 1`,
        });

        expect(status, `bulk run ${i} should return 201`).toBe(201);
        expect(body).toHaveProperty("success", true);
      }
    });
  });

  describe("when sending non-RUN_STARTED events", () => {
    it("R5: MESSAGE_SNAPSHOT passes through without limit check (201)", async () => {
      // Send a MESSAGE_SNAPSHOT referencing an existing set
      // This should never be blocked regardless of limit state
      const { status, body } = await sendMessageSnapshot(setId(1), {
        scenarioId: scenarioId("set1"),
        scenarioRunId: runId("set1-run1"),
        batchRunId: batchId("set1"),
      });

      expect(status, "MESSAGE_SNAPSHOT should return 201").toBe(201);
      expect(body).toHaveProperty("success", true);
    });
  });
});
