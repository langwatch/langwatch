/**
 * `POST /api/ops/clickhouse/explain` through the real Hono app the API
 * process mounts — `runtime.mount` over the ops module's own application.
 */
// @vitest-environment node
import type { OpsApi } from "@langwatch/ops-contract";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition.ts";
import { createApiRestRuntime } from "../../../app-rest/api-rest.runtime.ts";
import { mountOpsClickHouseExplainRest } from "../ops-clickhouse-explain-rest.mount.ts";

describe("given the operator-only ClickHouse EXPLAIN endpoint", () => {
  describe("when the operator secret and a well-formed request are presented", () => {
    it("answers 200 with the plan's type and rows", async () => {
      const authorizeOperatorSecret = vi.fn();
      const explainClickHouseQuery = vi.fn(async () => ({
        status: "ok" as const,
        type: "EXPLAIN",
        rows: ["Aggregating"],
      }));
      const world = mount({ authorizeOperatorSecret, explainClickHouseQuery });

      const response = await world.send({
        headers: { authorization: "Bearer ops-secret" },
        body: { query: "SELECT 1", type: "PLAN" },
      });

      expect(authorizeOperatorSecret).toHaveBeenCalledWith({ presented: "ops-secret" });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ type: "EXPLAIN", rows: ["Aggregating"] });
    });
  });

  describe("when the application refuses the presented secret", () => {
    it("lets the application's own refusal reach the process error envelope", async () => {
      const authorizeOperatorSecret = vi.fn(() => {
        throw new Error("refused");
      });
      const world = mount({ authorizeOperatorSecret });

      const response = await world.send({ headers: {}, body: { query: "SELECT 1", type: "PLAN" } });

      expect(response.status).toBe(500);
    });
  });

  describe("when the deployment provisioned no dedicated ClickHouse account", () => {
    it("answers 503 in the bespoke body the operator tool already parses", async () => {
      const authorizeOperatorSecret = vi.fn();
      const explainClickHouseQuery = vi.fn(async () => ({
        status: "unavailable" as const,
      }));
      const world = mount({ authorizeOperatorSecret, explainClickHouseQuery });

      const response = await world.send({
        headers: { authorization: "Bearer ops-secret" },
        body: { query: "SELECT 1", type: "PLAN" },
      });

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        message: "ClickHouse is not configured on this instance",
      });
    });
  });
});

// ---------------------------------------------------------------------------

function mount(overrides: {
  authorizeOperatorSecret: OpsApi["authorizeOperatorSecret"];
  explainClickHouseQuery?: OpsApi["explainClickHouseQuery"];
}) {
  const errors = ApiRestObservabilityComposition.create().legacyErrorHandler;
  const runtime = createApiRestRuntime({
    projectCredential: () => {
      throw new Error("This door resolves no project credential of its own.");
    },
    organizationCredential: () => {
      throw new Error("This door resolves no organization credential of its own.");
    },
    organizationIdentity: () => {
      throw new Error("This door resolves no organization credential of its own.");
    },
    routeAuthorization: () => {
      throw new Error("This suite authorizes no route-scoped permission.");
    },
    errors,
  });

  const ops = {
    authorizeOperatorSecret: overrides.authorizeOperatorSecret,
    explainClickHouseQuery: overrides.explainClickHouseQuery ?? vi.fn(),
  } as OpsApi;
  const mounted = mountOpsClickHouseExplainRest(runtime, { ops: () => ops });
  const hono = new Hono().route("/", mounted);

  return {
    send: (init: { headers: Record<string, string>; body: unknown }) =>
      hono.fetch(
        new Request("http://api.test/api/ops/clickhouse/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...init.headers },
          body: JSON.stringify(init.body),
        }),
      ),
  };
}
