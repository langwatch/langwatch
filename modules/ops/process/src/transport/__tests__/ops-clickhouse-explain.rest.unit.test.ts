/**
 * The operator EXPLAIN door refuses a caller without the secret before it reads
 * the body: 401 ahead of any 400 or 422, in the `{ message }` the tool parses.
 * @vitest-environment node
 */
import { bindRestCredential, BearerIdentity, RestHost } from "@langwatch/api/rest";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import { createOpsTestApp } from "../../app/__tests__/ops.fixture.ts";
import { opsClickHouseExplainRest } from "../ops-clickhouse-explain.rest.ts";

const SECRET = "operator-secret";
const UNAUTHORIZED = { message: "Unauthorized" };

/** The route as the ops module mounts it, its door built from `findOpsApiKey`. */
function mountApp(configured: string | null = SECRET, sent: unknown[] = []) {
  const { app } = createOpsTestApp({ members: { findOpsApiKey: () => configured } });
  app.connectClickHouseExplain({
    requestClickHouseExplain: { send: async (input) => void sent.push(input) },
  });
  const closed = BearerIdentity.create({ name: "unbound", token: void 0 });
  const host = RestHost.create({
    authz: restTestAuthorization().forRequest(),
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      instance_admin: closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => {} },
  });

  host.mount(opsClickHouseExplainRest.router(), () => app, {
    middlewareBindings: [bindRestCredential("internal_secret", () => app.operatorDoor)],
  });

  return host.app;
}

const explain = ({
  body,
  authorization,
  configured,
}: {
  body: string;
  authorization?: string;
  configured?: string | null;
}) =>
  mountApp(configured).request("/api/ops/clickhouse/explain", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body,
  });

describe("POST /api/ops/clickhouse/explain", () => {
  describe("when the caller presents no secret", () => {
    /** @scenario "The operator EXPLAIN door refuses a caller without the secret before the body" */
    it("answers main's 401 to a body that is not JSON and to one that fails the schema", async () => {
      const malformed = await explain({ body: "not json" });
      const invalid = await explain({ body: "{}" });

      expect(malformed.status).toBe(401);
      await expect(malformed.json()).resolves.toEqual(UNAUTHORIZED);
      expect(invalid.status).toBe(401);
      await expect(invalid.json()).resolves.toEqual(UNAUTHORIZED);
    });
  });

  describe("when the caller presents the wrong secret", () => {
    /** @scenario "A wrong operator secret is refused with main's 401" */
    it("answers main's 401", async () => {
      const response = await explain({ body: "{}", authorization: "Bearer operator-secreT" });

      expect(response.status).toBe(401);
      expect(response.headers.get("content-type")).toContain("application/json");
      await expect(response.json()).resolves.toEqual(UNAUTHORIZED);
    });
  });

  describe("when the caller presents the secret with no Bearer scheme", () => {
    /** @scenario "A wrong operator secret is refused with main's 401" */
    it("answers main's 401, as main's scheme-required parse did", async () => {
      const bare = await explain({ body: "{}", authorization: SECRET });
      const basic = await explain({ body: "{}", authorization: `Basic ${SECRET}` });

      for (const response of [bare, basic]) {
        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual(UNAUTHORIZED);
      }
    });
  });

  describe("when the deployment set no operator secret, or a blank one", () => {
    /** @scenario "A deployment without an operator secret refuses every call with main's 401" */
    it("answers main's 401 even to a caller presenting nothing or a blank bearer", async () => {
      const unset = await explain({ body: "{}", configured: null });
      const blank = await explain({ body: "{}", authorization: "Bearer  ", configured: "  " });
      const empty = await explain({ body: "{}", authorization: "Bearer ", configured: "" });

      for (const response of [unset, blank, empty]) {
        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual(UNAUTHORIZED);
      }
    });
  });

  describe("when the caller presents the secret", () => {
    /** @scenario "A caller with the operator secret has the body judged" */
    it("answers 400 to a body that is not JSON and 422 naming the field that failed", async () => {
      const malformed = await explain({ body: "not json", authorization: `Bearer ${SECRET}` });
      const invalid = await explain({ body: "{}", authorization: `Bearer ${SECRET}` });

      expect(malformed.status).toBe(400);
      await expect(malformed.json()).resolves.toEqual({ message: "request body must be JSON" });
      expect(invalid.status).toBe(422);
      await expect(invalid.json()).resolves.toEqual({ message: expect.stringMatching(/^query: /) });
    });

    /** @scenario "A caller with the operator secret has the body judged" */
    it("reads the scheme in any letter case and trims, as main's parse did", async () => {
      for (const authorization of [`bearer ${SECRET}`, `  BEARER   ${SECRET}  `]) {
        const invalid = await explain({ body: "{}", authorization });

        expect(invalid.status, authorization).toBe(422);
      }
    });
  });

  describe("when the caller presents the secret and a query the guardrails judge", () => {
    const authorized = { "content-type": "application/json", authorization: `Bearer ${SECRET}` };

    /** @scenario "An accepted EXPLAIN answers 202 with a request id and runs on the worker" */
    it("answers 202 with a request id, then pending on the poll until a worker runs it", async () => {
      const sent: unknown[] = [];
      const host = mountApp(SECRET, sent);
      const accepted = await host.request("/api/ops/clickhouse/explain", {
        method: "POST",
        headers: authorized,
        body: JSON.stringify({ query: "SELECT 1", type: "PLAN" }),
      });

      expect(accepted.status).toBe(202);
      const { requestId } = (await accepted.json()) as { requestId: string };
      expect(sent).toEqual([expect.objectContaining({ requestId })]);
      const polled = await host.request(`/api/ops/clickhouse/explain/${requestId}`, {
        headers: authorized,
      });
      expect(polled.status).toBe(200);
      await expect(polled.json()).resolves.toEqual({ status: "pending" });
    });

    /** @scenario "A query the guardrails refuse is answered at once and sends nothing" */
    it("answers 400 at once to a query that is not a single SELECT, sending nothing", async () => {
      const sent: unknown[] = [];
      const refused = await mountApp(SECRET, sent).request("/api/ops/clickhouse/explain", {
        method: "POST",
        headers: authorized,
        body: JSON.stringify({ query: "DROP TABLE stored_spans" }),
      });

      expect(refused.status).toBe(400);
      await expect(refused.json()).resolves.toEqual({ message: expect.any(String) });
      expect(sent).toEqual([]);
    });

    /** @scenario "An unknown request id answers 404" */
    it("answers 404 on the poll for an id it never accepted, and 401 without the secret", async () => {
      const host = mountApp();
      const unknown = await host.request("/api/ops/clickhouse/explain/never-accepted", {
        headers: authorized,
      });
      const anonymous = await host.request("/api/ops/clickhouse/explain/never-accepted");

      expect(unknown.status).toBe(404);
      await expect(unknown.json()).resolves.toEqual({ message: expect.any(String) });
      expect(anonymous.status).toBe(401);
      await expect(anonymous.json()).resolves.toEqual(UNAUTHORIZED);
    });
  });
});
