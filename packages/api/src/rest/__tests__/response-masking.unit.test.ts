import { HandledError, handledErrorFromHerr } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import { apiErrorBody, apiErrorSchema, canonicalErrorFor } from "../response.ts";

// Record §8 and the 2026-10-05 ruling: a 5xx body is kept only when the class declares the
// failure the caller's; anything else at 5xx answers the opaque internal_error body.

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

class ReplicaRefusedError extends HandledError {
  constructor() {
    super("agent_register_refused", "This deployment cannot run more than one replica", {
      httpStatus: 503,
      fault: "customer",
      meta: { frame: { reason: "replica_count_unsupported" } },
    });
    this.name = "ReplicaRefusedError";
  }
}

const OPAQUE = { code: "internal_error" };

describe("canonicalErrorFor", () => {
  describe("when a HandledError declares a platform fault at 503", () => {
    /** @scenario "A 5xx the class does not declare the caller's stays masked" */
    it("answers the opaque body at its own status", () => {
      const { status, body } = canonicalErrorFor(new PoolDrainedError());

      expect(status).toBe(503);
      expect(body).toMatchObject(OPAQUE);
      expect(body).not.toHaveProperty("meta");
      expect(JSON.stringify(body)).not.toContain("db-7");
    });
  });

  describe("when a HandledError at 503 declares no fault at all", () => {
    /** @scenario "A 5xx the class does not declare the caller's stays masked" */
    it("answers the opaque body, because an undeclared fault is not a customer fault", () => {
      const relayed = handledErrorFromHerr(
        { type: "auth_upstream_unavailable", message: "upstream idp 10.0.0.4 timed out" },
        { httpStatus: 503 },
      );

      const { status, body } = canonicalErrorFor(relayed);

      expect(status).toBe(503);
      expect(body).toMatchObject(OPAQUE);
      expect(body).not.toHaveProperty("meta");
      expect(JSON.stringify(body)).not.toContain("10.0.0.4");
    });
  });

  describe("when a plain Error is thrown", () => {
    /** @scenario "A 5xx the class does not declare the caller's stays masked" */
    it("answers the opaque 500", () => {
      const { status, body } = canonicalErrorFor(new Error("connection string postgres://x"));

      expect(status).toBe(500);
      expect(body).toMatchObject(OPAQUE);
      expect(JSON.stringify(body)).not.toContain("postgres://");
    });
  });

  describe("when a HandledError declares a customer fault at 503", () => {
    /** @scenario "A 5xx the class declares the caller's keeps its body" */
    it("keeps its code, message and meta at its own status", () => {
      const { status, body } = canonicalErrorFor(new ReplicaRefusedError());

      expect(status).toBe(503);
      expect(body).toMatchObject({
        code: "agent_register_refused",
        message: "This deployment cannot run more than one replica",
        meta: { frame: { reason: "replica_count_unsupported" } },
      });
    });
  });
});

describe("apiErrorSchema", () => {
  /** @scenario "A presumed platform fault goes on the wire as itself" */
  it("accepts presumed_platform as a fault", () => {
    const body = apiErrorBody({
      status: 503,
      code: "internal_error",
      message: "Internal server error",
      fault: "presumed_platform",
    });

    expect(apiErrorSchema.parse(body).fault).toBe("presumed_platform");
  });
});
