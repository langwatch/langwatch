import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

const LANGWATCH_ENDPOINT =
  process.env.LANGWATCH_ENDPOINT ?? "http://localhost:5560";

const LANGWATCH_API_KEY = process.env.LANGWATCH_API_KEY;

/**
 * Stress tests for experiment init limit enforcement (R1, R2, R6).
 *
 * These hit the real /api/experiment/init endpoint with raw fetch.
 * Free plan allows 3 experiments; the 4th must be blocked with 403.
 * Re-running an existing slug must always succeed (200).
 *
 * Run with: pnpm test:stress
 * Requires: LANGWATCH_API_KEY env var and a running instance.
 */
describe("Experiment init limit enforcement", () => {
  let apiKey: string;
  const prefix = nanoid(8);

  function slug(n: number): string {
    return `stress-exp-${prefix}-${n}`;
  }

  async function initExperiment(
    experimentSlug: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${LANGWATCH_ENDPOINT}/api/experiment/init`, {
      method: "POST",
      headers: {
        "X-Auth-Token": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        experiment_slug: experimentSlug,
        experiment_type: "BATCH_EVALUATION",
      }),
    });

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

  describe("when creating experiments up to the free-plan limit", () => {
    it("R1: allows the first 3 experiments and blocks the 4th with 403", async () => {
      // Create 3 experiments -- all should succeed
      for (let i = 1; i <= 3; i++) {
        const { status, body } = await initExperiment(slug(i));

        expect(status, `experiment ${i} should return 200`).toBe(200);
        expect(body).toHaveProperty("path");
        expect(body).toHaveProperty("slug");
      }

      // 4th experiment -- should be blocked
      const { status, body } = await initExperiment(slug(4));

      expect(status, "4th experiment should return 403").toBe(403);
      expect(body).toHaveProperty("error", "resource_limit_exceeded");
      expect(body).toHaveProperty("limitType", "experiments");
    });

    it("R6: 403 response body has the structured error shape", async () => {
      // At this point we are already at the limit from R1,
      // so a new slug should be blocked
      const { status, body } = await initExperiment(slug(5));

      expect(status).toBe(403);
      expect(body).toEqual(
        expect.objectContaining({
          error: "resource_limit_exceeded",
          limitType: "experiments",
          current: expect.any(Number),
          max: expect.any(Number),
          message: expect.any(String),
        }),
      );
      expect(body.current).toBeGreaterThanOrEqual(body.max as number);
    });
  });

  describe("when re-running an existing experiment at the limit", () => {
    it("R2: re-running an existing slug returns 200 even at the limit", async () => {
      // slug(1) was created in R1 -- re-init must succeed
      const { status, body } = await initExperiment(slug(1));

      expect(status, "re-run should return 200").toBe(200);
      expect(body).toHaveProperty("path");
      expect(body).toHaveProperty("slug");
    });
  });
});
