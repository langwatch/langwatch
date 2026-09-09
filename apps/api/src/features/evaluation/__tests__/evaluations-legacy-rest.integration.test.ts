/**
 * The legacy evaluation family as this process mounts it, driven through the real Hono
 * app the door registry opens. Two facts are worth pinning, and they are
 * the two halves of the mount's decision.
 */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { openTestRestDoors } from "../../../app-rest/__tests__/support/rest-doors.harness.ts";

describe("given the evaluator catalogue this process compiles in", () => {
  describe("when an unauthenticated caller reads it", () => {
    it("answers the built-in evaluators with their settings schemas", async () => {
      const api = mount();

      const response = await api.fetch("/api/evaluations/list");

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        evaluators: Record<string, { name: string; settings_json_schema: unknown }>;
      };
      const ids = Object.keys(body.evaluators);
      expect(ids.length).toBeGreaterThan(0);
      // The three excluded families never reach a caller, and every entry
      // carries the JSON Schema an SDK builds its settings form from.
      expect(ids.some((id) => id.startsWith("example/"))).toBe(false);
      expect(ids).not.toContain("aws/comprehend_pii_detection");
      expect(ids).not.toContain("google_cloud/dlp_pii_detection");
      const first = body.evaluators[ids[0]!]!;
      expect(first.settings_json_schema).toBeDefined();
    });
  });
});

describe("given a process that composed no evaluator runtime", () => {
  describe("when an SDK posts an evaluation to run", () => {
    it("does not register the evaluate door at all", async () => {
      const api = mount();

      const response = await api.fetch("/api/evaluations/ragas/faithfulness/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-auth-token": "token" },
        body: JSON.stringify({ data: { input: "hi", output: "there" } }),
      });

      // 404, never 401: a door that authenticated and then had nothing to run
      // is one an SDK retries forever.
      expect(response.status).toBe(404);
    });
  });

  describe("when an SDK posts batch evaluation rows", () => {
    it("does not register the batch log either", async () => {
      const api = mount();

      const response = await api.fetch("/api/evaluations/batch/log_results", {
        method: "POST",
        headers: { "content-type": "application/json", "x-auth-token": "token" },
        body: JSON.stringify({ experiment_slug: "e", run_id: "r", dataset: [] }),
      });

      expect(response.status).toBe(404);
    });
  });
});

// ---------------------------------------------------------------------------

function mount() {
  const hono = new Hono();
  for (const app of openTestRestDoors({
    ports: {
      handlerManagedCredential: () =>
        Promise.resolve({
          ok: true as const,
          project: { id: "project-1" },
          resolved: {
            type: "legacyProjectKey" as const,
            project: { id: "project-1" } as never,
          },
          markUsed: () => void 0,
        }),
      rateLimit: async () => ({ allowed: true }),
    },
  })) {
    hono.route("/", app);
  }
  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}
