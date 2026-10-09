/**
 * @vitest-environment node
 * @see specs/upgrade/in-app-upgrade.feature
 */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { canonicalErrorResponse, withRetryAfter } from "../rest/response.ts";
import { SseLane } from "../trpc/sse.ts";

const schemaBehind = (code: string) =>
  Object.assign(new Error("The table `public.NewThing` does not exist"), { code });

async function restAnswerFor(failure: unknown): Promise<Response> {
  const app = new Hono();
  app.get("/read", () => {
    throw failure;
  });
  app.onError(withRetryAfter((error, c) => canonicalErrorResponse(error, c)));
  return app.request("/read");
}

describe("a Postgres read the schema is not ready for", () => {
  describe("when a REST handler's query names a table or column a pending step adds", () => {
    /** @scenario "A Postgres read the schema is not ready for answers upgrade_in_progress" */
    it.each(["P2021", "P2022", "42P01", "42703"])(
      "answers %s as 503 upgrade_in_progress with Retry-After",
      async (code) => {
        const response = await restAnswerFor(schemaBehind(code));

        expect(response.status).toBe(503);
        expect(response.headers.get("Retry-After")).toBe("10");
        expect(await response.json()).toMatchObject({ code: "upgrade_in_progress" });
      },
    );
  });

  describe("when a live subscription's query does", () => {
    /** @scenario "A Postgres read the schema is not ready for answers upgrade_in_progress" */
    it("ends the stream with the handled upgrade_in_progress frame", async () => {
      const lane = SseLane.create({
        members: {
          createCaller: async () => ({
            traces: {
              watch: async () => {
                throw schemaBehind("P2022");
              },
            },
          }),
          procedureTypeAt: () => "subscription",
        },
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      });

      const response = await lane.answer(
        new Request("http://api.test/api/sse/traces/watch", {
          headers: { "sec-fetch-site": "same-origin" },
        }),
        new Headers(),
      );

      expect(await response.text()).toContain('"message":"upgrade_in_progress"');
    });
  });
});
