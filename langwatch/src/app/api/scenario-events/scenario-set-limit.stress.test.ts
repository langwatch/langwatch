import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

const LANGWATCH_ENDPOINT =
  process.env.LANGWATCH_ENDPOINT ?? "http://localhost:5560";

const LANGWATCH_API_KEY = process.env.LANGWATCH_API_KEY;

/**
 * Stress tests for scenario set limit enforcement (R3, R4, R5, R6, R7).
 *
 * These hit the real /api/scenario-events endpoint with raw fetch.
 * Free plan allows 3 distinct scenario sets; beyond that, new sets return 403.
 * Adding runs to an existing set must always succeed (201).
 * Non-RUN_STARTED events pass through without limit checks.
 *
 * Run with: pnpm test:stress
 * Requires: LANGWATCH_API_KEY env var and a running instance.
 */
describe("Scenario set limit enforcement", () => {
  let apiKey: string;
  const prefix = nanoid(8);

  /** Set IDs created by this test run that returned 201 */
  const createdSetIds: string[] = [];
  /** The set ID that was blocked with 403 */
  let blockedSetId: string | undefined;

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

  describe("when creating scenario sets until the free-plan limit is hit", () => {
    it("R3: creates sets until blocked, then the next returns 403", async () => {
      // Keep creating distinct sets until we get a 403.
      // The org may already have sets from prior usage.
      const MAX_ATTEMPTS = 20;

      for (let i = 1; i <= MAX_ATTEMPTS; i++) {
        const { status, body } = await sendRunStarted(setId(i), {
          scenarioId: scenarioId(`set${i}`),
          scenarioRunId: runId(`set${i}-run1`),
          batchRunId: batchId(`set${i}`),
          name: `Stress Set ${i}`,
        });

        if (status === 201) {
          createdSetIds.push(setId(i));
          expect(body).toHaveProperty("success", true);
        } else if (status === 403) {
          blockedSetId = setId(i);
          expect(body).toHaveProperty("error", "scenario_set_limit_exceeded");
          expect(body).toHaveProperty("limitType", "scenarioSets");
          break;
        } else {
          expect.fail(`Unexpected status ${status} on set ${i}: ${JSON.stringify(body)}`);
        }
      }

      expect(blockedSetId, "should have hit the limit within 20 attempts").toBeDefined();
    });

    it("R6: 403 response body has the structured error shape", async () => {
      // Try another new set — should still be blocked
      const { status, body } = await sendRunStarted(setId(100), {
        scenarioId: scenarioId("set100"),
        scenarioRunId: runId("set100-run1"),
        batchRunId: batchId("set100"),
        name: "Stress Set 100",
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
      // Use the first set we created
      const existingSet = createdSetIds[0] ?? setId(1);
      const { status, body } = await sendRunStarted(existingSet, {
        scenarioId: scenarioId("extra"),
        scenarioRunId: runId("existing-set-run2"),
        batchRunId: batchId("existing-set-b"),
        name: "Extra run in existing set",
      });

      expect(status, "existing set run should return 201").toBe(201);
      expect(body).toHaveProperty("success", true);
    });

    it("R7: sends 5+ runs within a single set and all succeed (201)", async () => {
      // Send 5 more runs into the first set — every one should succeed
      const existingSet = createdSetIds[0] ?? setId(1);
      for (let i = 3; i <= 7; i++) {
        const { status, body } = await sendRunStarted(existingSet, {
          scenarioId: scenarioId(`bulk-${i}`),
          scenarioRunId: runId(`existing-set-run${i}`),
          batchRunId: batchId("existing-set-bulk"),
          name: `Bulk run ${i}`,
        });

        expect(status, `bulk run ${i} should return 201`).toBe(201);
        expect(body).toHaveProperty("success", true);
      }
    });
  });

  describe("when sending non-RUN_STARTED events", () => {
    it("R5: MESSAGE_SNAPSHOT passes through without limit check (201)", async () => {
      const existingSet = createdSetIds[0] ?? setId(1);
      const { status, body } = await sendMessageSnapshot(existingSet, {
        scenarioId: scenarioId("set1"),
        scenarioRunId: runId("set1-run1"),
        batchRunId: batchId("set1"),
      });

      expect(status, "MESSAGE_SNAPSHOT should return 201").toBe(201);
      expect(body).toHaveProperty("success", true);
    });
  });
});
