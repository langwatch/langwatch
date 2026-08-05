/**
 * What POST /api/experiments/:slug/comparison builds when it accepts: which
 * targets it creates, and which it reuses instead of duplicating.
 *
 * @see specs/experiments-v3/cli-comparison-target.feature
 *
 * Requires the app running at TEST_BASE_URL (default http://localhost:5560).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authHeadersFor,
  type ComparisonFixture,
  cleanupComparisonFixture,
  comparisonBaseUrl,
  createComparisonFixture,
  postComparison,
} from "./fixtures/comparisonRouteHarness";

describe.skipIf(process.env.CI)(
  "POST /api/experiments/:slug/comparison",
  () => {
    let fixture: ComparisonFixture;
    let testSlug: string;

    const _getBaseUrl = comparisonBaseUrl;
    const post = (
      slug: string,
      body: unknown,
      headers: Record<string, string> = {},
    ) => postComparison({ slug, body, headers });
    const authHeaders = () => authHeadersFor(fixture);

    beforeAll(async () => {
      fixture = await createComparisonFixture("comparison-cli-test");
      testSlug = fixture.slug;
    });

    afterAll(() => cleanupComparisonFixture(fixture));

    describe("attaching a comparison to existing targets", () => {
      /** @scenario "A comparison attached over the API is persisted on the experiment" */
      it("adds one comparison target referencing both existing targets, without duplicating them", async () => {
        const response = await post(
          testSlug,
          {
            variants: [
              { kind: "existingTarget", targetId: "target-a" },
              { kind: "existingTarget", targetId: "target-b" },
            ],
            goldenField: "expected_output",
          },
          authHeaders(),
        );

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.comparisonTargetId).toBeDefined();
        // Asserted as a delta, not an absolute count: every case in this file
        // writes to the same experiment, so a total would encode the order the
        // blocks happen to run in.
        expect(body.createdTargetIds).toEqual([]);

        const comparisonTarget = body.targets.find(
          (t: { id: string }) => t.id === body.comparisonTargetId,
        );
        expect(comparisonTarget.type).toBe("evaluator");
        expect(comparisonTarget.comparison.variants.sort()).toEqual([
          "target-a",
          "target-b",
        ]);
      });
    });

    describe("attaching a comparison that creates missing variant targets", () => {
      it("creates an agent target inline and reuses it on a second call", async () => {
        const firstResponse = await post(
          testSlug,
          {
            variants: [
              { kind: "existingTarget", targetId: "target-a" },
              { kind: "agent", agentId: fixture.agent.id },
            ],
          },
          authHeaders(),
        );

        expect(firstResponse.status).toBe(200);
        const firstBody = await firstResponse.json();
        expect(firstBody.createdTargetIds).toHaveLength(1);
        const createdAgentTargetId = firstBody.createdTargetIds[0];

        const secondResponse = await post(
          testSlug,
          {
            variants: [
              { kind: "existingTarget", targetId: "target-b" },
              { kind: "agent", agentId: fixture.agent.id },
            ],
          },
          authHeaders(),
        );

        expect(secondResponse.status).toBe(200);
        const secondBody = await secondResponse.json();
        // The agent target created by the first call is reused, not duplicated.
        expect(secondBody.createdTargetIds).toEqual([]);
        expect(secondBody.reusedTargetIds).toContain(createdAgentTargetId);
      });
    });
  },
);
