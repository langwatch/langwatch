import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/env.mjs", () => ({
  env: { LANGEVALS_ENDPOINT: "http://test-langevals" },
}));

vi.mock("~/server/metrics", () => ({
  getPiiChecksCounter: () => ({ inc: () => undefined }),
  getEvaluationStatusCounter: () => ({ inc: () => undefined }),
  evaluationDurationHistogram: { labels: () => ({ observe: () => undefined }) },
}));

import { batchPresidioClearPII } from "./piiCheck";

describe("batchPresidioClearPII", () => {
  let capturedBody: { settings: { entities: Record<string, boolean> } };

  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(
      async (_url: unknown, init: unknown) => {
        const body = (init as { body: string }).body;
        capturedBody = JSON.parse(body);
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => [
            { status: "processed", raw_response: { anonymized: "scrubbed" } },
          ],
        } as unknown as Response;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("given a custom entity selection narrower than the level default", () => {
    describe("when the level is STRICT but only PERSON is requested", () => {
      it("sends only the selected entity to the analysis service", async () => {
        await batchPresidioClearPII(["any text"], "STRICT", ["PERSON"]);

        expect(capturedBody.settings.entities).toEqual({ person: true });
      });
    });
  });

  describe("given no custom entities", () => {
    describe("when the level is ESSENTIAL", () => {
      it("sends the full essential entity list and excludes strict-only ones", async () => {
        await batchPresidioClearPII(["any text"], "ESSENTIAL");

        expect(capturedBody.settings.entities.credit_card).toBe(true);
        expect(capturedBody.settings.entities.email_address).toBe(true);
        expect(capturedBody.settings.entities.person).toBeUndefined();
      });
    });
  });
});
