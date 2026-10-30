/**
 * The HTTP hook call's body, signature and answer (ADR-188).
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  HOOK_ERROR_BODY_CHARS,
  hookAnswer,
  hookIdempotencyKey,
  hookRequestBody,
  hookSignature,
  hookTimeoutMessage,
  HttpHookError,
} from "../rules/http-hook.rules.ts";

const run = { scenarioRunId: "run_1", scenarioName: "Refund", batchRunId: "batch_1" };

/** What a receiver does: recompute over the raw bytes, compare in constant time. */
function receiverAccepts({
  header,
  rawBody,
  secret,
}: {
  header: string;
  rawBody: Buffer;
  secret: string;
}) {
  const [tPart, v1Part] = header.split(",");
  const t = tPart?.replace(/^t=/, "") ?? "";
  const v1 = v1Part?.replace(/^v1=/, "") ?? "";
  const expected = createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${t}.`, "utf8"), rawBody]))
    .digest("hex");
  return v1.length === expected.length && timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}

describe("hookSignature()", () => {
  /** @scenario "An HTTP hook call is signed so the receiver can verify it" */
  it("lets a receiver recompute it over the raw bytes with the secret", () => {
    const body = hookRequestBody({ kind: "setup", run, params: { name: "Zoë" }, state: null });

    const header = hookSignature({ secret: "whsec_test", body, timestampSeconds: 1_761_800_000 });

    expect(header).toMatch(/^t=1761800000,v1=[0-9a-f]{64}$/);
    expect(
      receiverAccepts({ header, rawBody: Buffer.from(body, "utf8"), secret: "whsec_test" }),
    ).toBe(true);
  });

  it("does not verify with another secret or a changed body", () => {
    const body = hookRequestBody({ kind: "setup", run, params: {}, state: null });
    const header = hookSignature({ secret: "whsec_test", body, timestampSeconds: 1 });

    expect(receiverAccepts({ header, rawBody: Buffer.from(body), secret: "whsec_other" })).toBe(
      false,
    );
    expect(
      receiverAccepts({ header, rawBody: Buffer.from(`${body} `), secret: "whsec_test" }),
    ).toBe(false);
  });
});

describe("hookTimeoutMessage()", () => {
  it("names the fixed 60 s budget", () => {
    expect(hookTimeoutMessage(60_000)).toBe("hook timed out after 60 s");
  });
});

describe("hookIdempotencyKey()", () => {
  /** @scenario "An HTTP hook call carries the run's idempotency key" */
  it("is the run id and the hook kind", () => {
    expect(hookIdempotencyKey({ run, kind: "setup" })).toBe("run_1:setup");
    expect(hookIdempotencyKey({ run, kind: "teardown" })).toBe("run_1:teardown");
  });
});

describe("hookRequestBody()", () => {
  it("gives setup no state and teardown the state", () => {
    const state = { customerId: "c_1" };

    expect(JSON.parse(hookRequestBody({ kind: "setup", run, params: {}, state }))).toEqual({
      kind: "setup",
      run,
      params: {},
    });
    expect(JSON.parse(hookRequestBody({ kind: "teardown", run, params: {}, state }))).toEqual({
      kind: "teardown",
      run,
      params: {},
      state,
    });
  });
});

describe("hookAnswer()", () => {
  it("is setup's JSON object", () => {
    expect(hookAnswer({ kind: "setup", status: 200, body: '{"customerId":"c_1"}' })).toEqual({
      customerId: "c_1",
    });
  });

  describe("when teardown answers 2xx with an empty body", () => {
    it("succeeds with no returned object, 204 included", () => {
      expect(hookAnswer({ kind: "teardown", status: 204, body: "" })).toBeUndefined();
      expect(hookAnswer({ kind: "teardown", status: 200, body: "  " })).toBeUndefined();
    });
  });

  describe("when the body is not a JSON object", () => {
    /** @scenario "An HTTP hook answer that is not a JSON object fails the hook" */
    it("fails with the status and the first 1000 characters of the body", () => {
      const body = "x".repeat(HOOK_ERROR_BODY_CHARS + 500);

      const call = () => hookAnswer({ kind: "setup", status: 200, body });

      expect(call).toThrow(HttpHookError);
      expect(call).toThrow(
        `The setup hook answered HTTP 200 without a JSON object: ${"x".repeat(HOOK_ERROR_BODY_CHARS)}`,
      );
      expect(call).not.toThrow("x".repeat(HOOK_ERROR_BODY_CHARS + 1));
    });

    it("fails setup on an empty body, and teardown on an array", () => {
      expect(() => hookAnswer({ kind: "setup", status: 200, body: "" })).toThrow(HttpHookError);
      expect(() => hookAnswer({ kind: "teardown", status: 200, body: "[1]" })).toThrow(
        HttpHookError,
      );
    });
  });

  describe("when the status is not 2xx", () => {
    it("fails with the status and the body", () => {
      expect(() => hookAnswer({ kind: "setup", status: 500, body: "db down" })).toThrow(
        "The setup hook answered HTTP 500: db down",
      );
    });
  });

  describe("when the object is over the state cap", () => {
    it("fails the hook", () => {
      const body = JSON.stringify({ blob: "y".repeat(70 * 1024) });

      expect(() => hookAnswer({ kind: "setup", status: 200, body })).toThrow(/cap/);
    });
  });
});
