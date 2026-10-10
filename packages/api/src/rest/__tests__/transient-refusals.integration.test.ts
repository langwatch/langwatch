import { HandledError, handledErrorFromHerr } from "@langwatch/handled-error";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { SurfaceCapabilityUnavailableError } from "../../errors.ts";
import { canonicalErrorResponse, withRetryAfter } from "../response.ts";

// Rulings 2026-10-06, round 9 (CH-1): a transient 503 refusal keeps its body through the
// 5xx mask; every other undeclared 5xx answers the opaque internal_error body.

class OverloadRefusal extends HandledError {
  constructor({ httpStatus = 503 }: { httpStatus?: number } = {}) {
    super("clickhouse_overloaded", "Too many queries in flight", {
      httpStatus,
      fault: "platform",
      retryable: true,
      meta: { retryAfterMs: 2500 },
      reasons: [new Error("statement slot timed out on ch-node-3 10.0.0.9")],
    });
    this.name = "OverloadRefusal";
  }
}

class PoolDrainedError extends HandledError {
  constructor() {
    super("pool_drained", "Replica pool drained on host db-7", {
      httpStatus: 503,
      fault: "platform",
      meta: { host: "db-7" },
    });
    this.name = "PoolDrainedError";
  }
}

/** A route that throws `failure`, behind the boundary every REST family uses. */
async function answerFor(failure: unknown): Promise<Response> {
  const app = new Hono();
  app.get("/refuse", () => {
    throw failure;
  });
  app.onError(withRetryAfter((error, c) => canonicalErrorResponse(error, c)));

  return app.request("/refuse");
}

describe("a transient 503 refusal over REST", () => {
  describe("when a statement finds ClickHouse overloaded", () => {
    /** @scenario "A ClickHouse overload answers 503 clickhouse_overloaded over REST" */
    it("answers 503 with its own code and message", async () => {
      const response = await answerFor(new OverloadRefusal());
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body).toMatchObject({
        code: "clickhouse_overloaded",
        message: "Too many queries in flight",
        retryable: true,
      });
    });

    /** @scenario "A ClickHouse overload answers 503 clickhouse_overloaded over REST" */
    it("carries Retry-After from the wait", async () => {
      const response = await answerFor(new OverloadRefusal());

      expect(response.headers.get("Retry-After")).toBe("3");
    });

    /** @scenario "A ClickHouse overload answers 503 clickhouse_overloaded over REST" */
    it("still masks an unhandled reason underneath it", async () => {
      const response = await answerFor(new OverloadRefusal());

      expect(await response.text()).not.toContain("10.0.0.9");
    });
  });

  describe("when the deployment composed nothing behind the route", () => {
    /** @scenario "A deployment with nothing behind a route answers 503 service_unavailable over REST" */
    it("answers 503 service_unavailable with its own message", async () => {
      const response = await answerFor(new SurfaceCapabilityUnavailableError("trace recorder"));

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        code: "service_unavailable",
        message: "This deployment has no trace recorder.",
      });
    });
  });
});

describe("an undeclared 5xx outside the transient allowlist", () => {
  const OPAQUE = { code: "internal_error" };

  /** @scenario "An undeclared 5xx outside the transient allowlist stays masked" */
  it("masks a platform 503 with another code", async () => {
    const response = await answerFor(new PoolDrainedError());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject(OPAQUE);
    expect(body).not.toHaveProperty("meta");
    expect(JSON.stringify(body)).not.toContain("db-7");
  });

  /** @scenario "An undeclared 5xx outside the transient allowlist stays masked" */
  it("masks a transient code at a status other than 503", async () => {
    const response = await answerFor(new OverloadRefusal({ httpStatus: 500 }));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject(OPAQUE);
  });

  /** @scenario "An undeclared 5xx outside the transient allowlist stays masked" */
  it("masks a relayed 503 that declares no fault and another code", async () => {
    const relayed = handledErrorFromHerr(
      { type: "auth_upstream_unavailable", message: "upstream idp 10.0.0.4 timed out" },
      { httpStatus: 503 },
    );
    const response = await answerFor(relayed);

    expect(await response.json()).toMatchObject(OPAQUE);
  });

  /** @scenario "An undeclared 5xx outside the transient allowlist stays masked" */
  it("masks a plain thrown Error as the opaque 500", async () => {
    const response = await answerFor(new Error("service_unavailable on 10.0.0.1"));
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toMatchObject(OPAQUE);
    expect(text).not.toContain("10.0.0.1");
  });
});
