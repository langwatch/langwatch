/**
 * What POST /api/experiments/:slug/comparison refuses, and with which code.
 *
 * @see specs/experiments-v3/cli-comparison-target.feature
 *
 * Requires the app running at TEST_BASE_URL (default http://localhost:5560).
 * Mirrors the harness conventions in cicd-execution.integration.test.ts.
 *
 * Refusals are asserted on `error`, which the REST boundary fills with the
 * handled error's CODE. The prose in `message` is copy and will be reworded;
 * the code is what a caller branches on.
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
  "POST /api/experiments/:slug/comparison refusals",
  () => {
    let fixture: ComparisonFixture;
    let testSlug: string;

    const getBaseUrl = comparisonBaseUrl;
    const post = (
      slug: string,
      body: unknown,
      headers: Record<string, string> = {},
    ) => postComparison({ slug, body, headers });
    const authHeaders = () => authHeadersFor(fixture);

    beforeAll(async () => {
      fixture = await createComparisonFixture("comparison-refusals");
      testSlug = fixture.slug;
    });

    afterAll(() => cleanupComparisonFixture(fixture));

    describe("authentication", () => {
      it("returns 401 when no API key provided", async () => {
        const response = await post(testSlug, {
          variants: [
            { kind: "existingTarget", targetId: "target-a" },
            { kind: "existingTarget", targetId: "target-b" },
          ],
        });

        expect(response.status).toBe(401);
      });
    });

    describe("experiment lookup", () => {
      it("returns 404 for a non-existent experiment", async () => {
        const response = await post(
          "non-existent-slug",
          {
            variants: [
              { kind: "existingTarget", targetId: "target-a" },
              { kind: "existingTarget", targetId: "target-b" },
            ],
          },
          authHeaders(),
        );

        expect(response.status).toBe(404);
      });
    });

    describe("validation", () => {
      it("rejects fewer than two variants", async () => {
        const response = await post(
          testSlug,
          { variants: [{ kind: "existingTarget", targetId: "target-a" }] },
          authHeaders(),
        );

        // The `min(2)` bound lives on the request schema, so this is refused at
        // the validator with the field named rather than deeper in the service.
        expect(response.status).toBe(422);
        const body = await response.json();
        expect(body.error).toBe("validation_error");
        expect(body.fields).toContain("variants");
      });

      it("returns the current target ids when an existingTarget reference is unknown", async () => {
        const response = await post(
          testSlug,
          {
            variants: [
              { kind: "existingTarget", targetId: "does-not-exist" },
              { kind: "existingTarget", targetId: "target-b" },
            ],
          },
          authHeaders(),
        );

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe("comparison_variant_target_not_found");
        expect(body.availableTargets.map((t: { id: string }) => t.id)).toEqual(
          expect.arrayContaining(["target-a", "target-b"]),
        );
      });

      it("rejects a goldenField that isn't a real dataset column", async () => {
        const response = await post(
          testSlug,
          {
            variants: [
              { kind: "existingTarget", targetId: "target-a" },
              { kind: "existingTarget", targetId: "target-b" },
            ],
            goldenField: "not-a-real-column",
          },
          authHeaders(),
        );

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe("comparison_field_not_in_dataset");
        expect(body.availableColumns).toContain("expected_output");
      });
    });

    describe("rejecting a comparison-of-comparisons", () => {
      it("rejects a variant that is itself a comparison target", async () => {
        const setupResponse = await post(
          testSlug,
          {
            variants: [
              { kind: "existingTarget", targetId: "target-a" },
              { kind: "existingTarget", targetId: "target-b" },
            ],
          },
          authHeaders(),
        );
        // Asserted before the id is read: a failed setup would otherwise send
        // `targetId: undefined` below and fail the schema instead of the case
        // this block is about.
        expect(setupResponse.status).toBe(200);
        const { comparisonTargetId } = await setupResponse.json();

        const response = await post(
          testSlug,
          {
            variants: [
              { kind: "existingTarget", targetId: comparisonTargetId },
              { kind: "existingTarget", targetId: "target-a" },
            ],
          },
          authHeaders(),
        );

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe("comparison_variant_is_comparison");
      });
    });

    describe("rejecting variants that resolve to the same target", () => {
      it("rejects a duplicate existingTarget reference", async () => {
        const response = await post(
          testSlug,
          {
            variants: [
              { kind: "existingTarget", targetId: "target-a" },
              { kind: "existingTarget", targetId: "target-a" },
            ],
          },
          authHeaders(),
        );

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe("comparison_variants_not_distinct");
      });
    });

    describe("referencing an agent that does not exist", () => {
      it("returns a 404 rather than a generic failure", async () => {
        const response = await post(
          testSlug,
          {
            variants: [
              { kind: "existingTarget", targetId: "target-a" },
              { kind: "agent", agentId: "does-not-exist" },
            ],
          },
          authHeaders(),
        );

        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body.error).toBe("comparison_variant_agent_not_found");
        expect(body.agentId).toBe("does-not-exist");
      });
    });

    describe("malformed request body", () => {
      it("returns 400 for invalid JSON", async () => {
        const response = await fetch(
          `${getBaseUrl()}/api/experiments/${testSlug}/comparison`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: "{not valid json",
          },
        );

        expect(response.status).toBe(400);
      });

      it("returns 422 when variants is missing", async () => {
        const response = await post(testSlug, {}, authHeaders());

        expect(response.status).toBe(422);
      });
    });
  },
);
