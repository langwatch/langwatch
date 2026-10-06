/**
 * The operator EXPLAIN door refuses a caller without the secret before it reads
 * the body: 401 ahead of any 400 or 422, in the `{ message }` the tool parses.
 * @vitest-environment node
 */
import { bindRestCredential, BearerIdentity, RestHost } from "@langwatch/api/rest";
import { describe, expect, it } from "vitest";

import { createOpsTestApp } from "../../app/__tests__/ops.fixture.ts";
import { opsClickHouseExplainRest } from "../ops-clickhouse-explain.rest.ts";

const SECRET = "operator-secret";
const UNAUTHORIZED = { message: "Unauthorized" };

/** The route as the ops module mounts it, its door built from `findOpsApiKey`. */
function mountApp(configured: string | null = SECRET) {
  const { app } = createOpsTestApp({ members: { findOpsApiKey: () => configured } });
  const closed = BearerIdentity.create({ name: "unbound", token: void 0 });
  const host = RestHost.create({
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      scim_token: closed,
      instance_admin: closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => {} },
  });

  host.mount(opsClickHouseExplainRest.router(), () => app, {
    facts: [bindRestCredential("internal_secret", () => app.operatorDoor)],
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
  });
});
