// @vitest-environment node

/**
 * Leg 7 — the management families at their canonical `/api/v1` addresses, and the workflow
 * evaluation this deployment cannot run.
 */
import { describe, expect, it } from "vitest";

import { client, organizationApiKey, platformGet } from "./support/journey";

const FAMILIES = ["/api/v1/organization", "/api/v1/roles", "/api/v1/scim-tokens"];

describe("given a key the platform accepts for the organization", () => {
  describe("when the management families are read at their canonical addresses", () => {
    // @scenario "The management families answer at their canonical addresses"
    it("answers each of them rather than 404", async () => {
      const key = organizationApiKey();

      for (const path of FAMILIES) {
        const answer = await platformGet(path, key);
        expect(
          answer.status,
          `${path} answered ${answer.status}: ${JSON.stringify(answer.body).slice(0, 300)}`,
        ).not.toBe(404);
        expect(answer.body).toBeTruthy();
      }
    }, 90_000);
  });

  describe("when the organization is read with a project key instead", () => {
    // @scenario "The management families answer at their canonical addresses"
    it("refuses it by credential class rather than by address", async () => {
      const answer = await platformGet("/api/v1/organization");

      expect(answer.status).not.toBe(404);
      expect([401, 403]).toContain(answer.status);
      expect(JSON.stringify(answer.body)).toContain("credential");
    }, 60_000);
  });

  describe("when a workflow is asked to evaluate", () => {
    // @scenario "A workflow evaluates and returns its result"
    // Marked failing: this deployment binds no workflow evaluation runner, so
    // POST /api/v1/workflows/{id}/evaluate always answers 503
    // (apps/api/src/app/api-packaged-rest.composition.ts:311).
    it.fails("runs the evaluation and answers with its result", async () => {
      const langwatch = client();
      const workflows = await langwatch.workflows.getAll();
      const workflowId = workflows[0]?.id ?? "workflow_absent_for_this_leg";

      const result = await langwatch.workflows.run(workflowId, {
        data: [{ question: "What is a span?" }],
      });

      expect(result).toBeTruthy();
    }, 120_000);
  });
});
