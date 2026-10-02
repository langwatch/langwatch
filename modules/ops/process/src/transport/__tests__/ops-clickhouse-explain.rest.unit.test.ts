/**
 * The operator EXPLAIN door refuses a caller without the secret before it reads
 * the body: 401 ahead of any 400 or 422, in the `{ message }` the tool parses.
 * @vitest-environment node
 */
import { bindRestMiddleware, canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import { describe, expect, it } from "vitest";

import { createOpsTestApp } from "../../app/__tests__/ops.fixture.ts";
import { extractBearerSecret } from "../../rules/ops-door.rules.ts";
import { operatorSecret, opsClickHouseExplainRest } from "../ops-clickhouse-explain.rest.ts";

const SECRET = "operator-secret";

function mountApp() {
  const { app } = createOpsTestApp({ members: { findOpsApiKey: () => SECRET } });
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("The operator door resolves its own secret.");
      },
    },
  });

  return runtime.mount(opsClickHouseExplainRest.router(), {
    app: () => app,
    credential: "public",
    onError: (error, context) => canonicalErrorResponse(error, context),
    facts: [
      bindRestMiddleware(operatorSecret, (context) => {
        app.authorizeOperatorSecret({
          presented: extractBearerSecret(context.req.header("authorization") ?? null),
        });

        return null;
      }),
    ],
  });
}

const explain = (body: string, authorization?: string) =>
  mountApp().request("/api/ops/clickhouse/explain", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body,
  });

describe("POST /api/ops/clickhouse/explain", () => {
  describe("when the caller presents no secret", () => {
    it("answers 401 to a body that is not JSON", async () => {
      const response = await explain("not json");

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ message: "Unauthorized" });
    });

    it("answers 401 to a body that fails the schema", async () => {
      const response = await explain("{}");

      expect(response.status).toBe(401);
    });
  });

  describe("when the caller presents the wrong secret", () => {
    it("answers 401", async () => {
      const response = await explain("{}", "Bearer operator-secreT");

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ message: "Unauthorized" });
    });
  });

  describe("when the caller presents the secret", () => {
    it("answers 400 to a body that is not JSON", async () => {
      const response = await explain("not json", `Bearer ${SECRET}`);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ message: "request body must be JSON" });
    });

    it("answers 422 naming the field that failed", async () => {
      const response = await explain("{}", `Bearer ${SECRET}`);

      expect(response.status).toBe(422);
      const body: unknown = await response.json();
      expect(body).toEqual({ message: expect.stringMatching(/^query: /) });
    });
  });
});
