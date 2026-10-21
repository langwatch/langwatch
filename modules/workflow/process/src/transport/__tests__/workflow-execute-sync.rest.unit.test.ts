/**
 * @vitest-environment node
 * The execute-sync door: the relay's answer written as the HTTP response, the engine's verbatim
 * and the relay's own refusals as `{ error }` JSON.
 */
import { describe, expect, it } from "vitest";

import { executeSyncResponseOf } from "../workflow-execute-sync.rest.ts";

describe("executeSyncResponseOf", () => {
  describe("when the engine answered", () => {
    /** @scenario "The engine's answer to a synchronous execution passes through as text" */
    it("writes its status and body unchanged", async () => {
      const body = '{"status":"error","error":"boom"}';

      const response = executeSyncResponseOf({ kind: "engine", status: 422, body });

      expect(response.status).toBe(422);
      expect(await response.text()).toBe(body);
    });

    /** @scenario "The engine's answer to a synchronous execution passes through as text" */
    it("keeps the plain-text content type a string body has always carried", () => {
      const response = executeSyncResponseOf({ kind: "engine", status: 200, body: "{}" });

      expect(response.headers.get("content-type")).toBe("text/plain;charset=UTF-8");
    });
  });

  describe("when the relay refused the turn", () => {
    /** @scenario "A synchronous execution past the turn ceiling is a 504 in JSON" */
    it("writes a 504 past the turn ceiling as JSON", async () => {
      const response = executeSyncResponseOf({
        kind: "refused",
        status: 504,
        error: "The engine did not answer in time",
      });

      expect(response.status).toBe(504);
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(await response.json()).toEqual({ error: "The engine did not answer in time" });
    });

    /** @scenario "A synchronous execution whose caller went away is a 408 in JSON" */
    it("writes a 408 once the caller went away as JSON", async () => {
      const response = executeSyncResponseOf({
        kind: "refused",
        status: 408,
        error: "The caller went away",
      });

      expect(response.status).toBe(408);
      expect(await response.json()).toEqual({ error: "The caller went away" });
    });
  });
});
