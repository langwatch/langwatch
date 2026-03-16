import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

const LANGWATCH_ENDPOINT =
  process.env.LANGWATCH_ENDPOINT ?? "http://localhost:5560";

const LANGWATCH_API_KEY = process.env.LANGWATCH_API_KEY;

/**
 * Stress tests for experiment init limit enforcement (R1, R2, R6).
 *
 * These hit the real /api/experiment/init endpoint with raw fetch.
 * Free plan allows 3 experiments; beyond that, new slugs return 403.
 * Re-running an existing slug must always succeed (200).
 *
 * Run with: pnpm test:stress
 * Requires: LANGWATCH_API_KEY env var and a running instance.
 */
describe("Experiment init limit enforcement", () => {
  let apiKey: string;
  const prefix = nanoid(8);

  /** Slugs created by this test run that returned 200 */
  const createdSlugs: string[] = [];
  /** The slug that was blocked with 403 */
  let blockedSlug: string | undefined;

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

  describe("when creating experiments until the free-plan limit is hit", () => {
    it("R1: creates experiments until blocked, then the next returns 403", async () => {
      // Keep creating experiments until we get a 403.
      // The org may already have experiments from prior usage.
      const MAX_ATTEMPTS = 20;

      for (let i = 1; i <= MAX_ATTEMPTS; i++) {
        const { status, body } = await initExperiment(slug(i));

        if (status === 200) {
          createdSlugs.push(slug(i));
          expect(body).toHaveProperty("path");
          expect(body).toHaveProperty("slug");
        } else if (status === 403) {
          blockedSlug = slug(i);
          expect(body).toHaveProperty("error", "resource_limit_exceeded");
          expect(body).toHaveProperty("limitType", "experiments");
          break;
        } else {
          expect.fail(`Unexpected status ${status} on experiment ${i}: ${JSON.stringify(body)}`);
        }
      }

      expect(blockedSlug, "should have hit the limit within 20 attempts").toBeDefined();
    });

    it("R6: 403 response body has the structured error shape", async () => {
      // Try another new slug — should still be blocked
      const { status, body } = await initExperiment(slug(100));

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
      if (createdSlugs.length === 0) {
        // Org was already at limit before this test run — nothing we created.
        // Create a slug that will fail, then re-init it to prove re-runs work.
        // This can't work because we can't create at the limit. Skip gracefully.
        console.warn(
          "R2 skipped: org was already at experiment limit before test run. " +
          "Use a fresh org or delete experiments to test re-run behavior.",
        );
        return;
      }

      const existingSlug = createdSlugs[0]!;
      const { status, body } = await initExperiment(existingSlug);

      expect(status, "re-run should return 200").toBe(200);
      expect(body).toHaveProperty("path");
      expect(body).toHaveProperty("slug");
    });
  });
});
