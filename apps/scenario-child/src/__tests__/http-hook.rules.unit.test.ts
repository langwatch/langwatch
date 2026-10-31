/**
 * The HTTP hook call's body, signature and answer (ADR-188).
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import type { SsrfValidationResult } from "@langwatch/egress/ssrf/url-validator";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  HOOK_ERROR_BODY_CHARS,
  hookAnswer,
  hookIdempotencyKey,
  hookOriginRefusal,
  hookRequestBody,
  hookSigningSecretReferences,
  hooksUrlRefusal,
  plainHttpHookRefusal,
  hookTimeoutMessage,
  HttpHookError,
  readCappedBody,
  scrubbedObject,
  withoutReservedHookHeaders,
  type HookBodyStream,
} from "../rules/http-hook.rules.ts";

const run = { scenarioRunId: "run_1", scenarioName: "Refund", batchRunId: "batch_1" };
const idempotencyKey = "run_1:attempt_1:setup";

/** A body stream that hands out the given chunks and records whether it was cancelled. */
function streamOf(chunks: string[]): HookBodyStream & { cancelled: boolean; pulled: number } {
  const queue = chunks.map((chunk) => Buffer.from(chunk, "utf8"));
  const stream = {
    cancelled: false,
    pulled: 0,
    getReader: () => ({
      read: async () => {
        const value = queue.shift();
        if (value) stream.pulled += 1;
        return value ? { done: false, value } : { done: true };
      },
      cancel: async () => {
        stream.cancelled = true;
      },
    }),
  };
  return stream;
}

const NOW = Temporal.Instant.from("2026-10-30T12:00:00Z");

describe("hookSigningSecretReferences()", () => {
  const current = "{{ secrets.HTTP_SHOP_HOOKS_SIGNING_SECRET_2 }}";
  const previousReference = "{{ secrets.HTTP_SHOP_HOOKS_SIGNING_SECRET }}";

  /** @scenario "Rotating the hooks signing secret keeps the old one valid for 24 hours" */
  it("is the current secret, then the previous one while it has not expired", () => {
    expect(
      hookSigningSecretReferences({
        current,
        previous: { secret: previousReference, expiresAt: "2026-10-31T11:59:59Z" },
        now: NOW,
      }),
    ).toEqual([current, previousReference]);
  });

  /** @scenario "The replaced hooks signing secret stops signing and is deleted once it expires" */
  it("drops the previous secret once it has expired", () => {
    expect(
      hookSigningSecretReferences({
        current,
        previous: { secret: previousReference, expiresAt: "2026-10-30T12:00:00Z" },
        now: NOW,
      }),
    ).toEqual([current]);
  });

  it("drops a previous secret whose expiry cannot be read", () => {
    expect(
      hookSigningSecretReferences({
        current,
        previous: { secret: previousReference, expiresAt: "tomorrow" },
        now: NOW,
      }),
    ).toEqual([current]);
  });

  it("is the current secret alone when no rotation is open", () => {
    expect(hookSigningSecretReferences({ current, now: NOW })).toEqual([current]);
  });
});

describe("hookTimeoutMessage()", () => {
  it("names the fixed 60 s budget", () => {
    expect(hookTimeoutMessage(60_000)).toBe("hook timed out after 60 s");
  });
});

describe("hookIdempotencyKey()", () => {
  /** @scenario "An HTTP hook call carries the run's idempotency key" */
  it("is the run id, the attempt and the hook kind", () => {
    expect(hookIdempotencyKey({ run, attemptId: "attempt_1", kind: "setup" })).toBe(
      "run_1:attempt_1:setup",
    );
    expect(hookIdempotencyKey({ run, attemptId: "attempt_1", kind: "teardown" })).toBe(
      "run_1:attempt_1:teardown",
    );
  });

  describe("when the run is executed again under the same run id", () => {
    it("is a new key, so a receiver makes the data again", () => {
      expect(hookIdempotencyKey({ run, attemptId: "attempt_2", kind: "setup" })).not.toBe(
        hookIdempotencyKey({ run, attemptId: "attempt_1", kind: "setup" }),
      );
    });
  });

  describe("when there is no scenario run id", () => {
    /** @scenario "An HTTP hook call outside a scenario run still carries a key" */
    it("is still sent, as the attempt and the kind", () => {
      expect(hookIdempotencyKey({ run: {}, attemptId: "attempt_1", kind: "setup" })).toBe(
        "attempt_1:setup",
      );
    });
  });
});

describe("hooksUrlRefusal()", () => {
  it("accepts https", () => {
    expect(hooksUrlRefusal("https://shop.example.com/hooks")).toBeNull();
  });

  /** @scenario "An HTTP hooks URL must use https" */
  it.each([
    "http://shop.example.com/hooks",
    "http://10.0.0.5/hooks",
    "http://localhost:3000/hooks",
    "http://127.0.0.1/hooks",
    "http://[::1]/hooks",
    "ftp://shop.example.com",
    "http://127.evil.com/hooks",
    "http://127.0.0.1.nip.io/h",
  ])("refuses %s where local addresses are blocked", (url) => {
    expect(hooksUrlRefusal(url)).toMatch(/https/);
  });

  /** @scenario "Plain http reaches a hooks URL only at a local address where local addresses are allowed" */
  it.each(["http://localhost:3000/hooks", "http://127.0.0.1/hooks", "http://[::1]/hooks"])(
    "leaves plain http %s to the address check where local addresses are allowed",
    (url) => {
      expect(hooksUrlRefusal(url, { localAddressesAllowed: true })).toBeNull();
    },
  );

  it("still refuses a scheme that is neither https nor http", () => {
    expect(hooksUrlRefusal("ftp://localhost/h", { localAddressesAllowed: true })).toMatch(/https/);
  });

  it("refuses a value that is not a URL", () => {
    expect(hooksUrlRefusal("not a url")).toMatch(/not a valid URL/);
  });
});

describe("hookOriginRefusal()", () => {
  it("accepts a rendered URL on the saved hooks URL's origin", () => {
    expect(
      hookOriginRefusal({
        hooksUrl: "https://shop.example.com/hooks/{{ params.tenant }}?run={{ params.run }}",
        rendered: "https://shop.example.com/hooks/gold?run=r1",
      }),
    ).toBeNull();
  });

  /** @scenario "A hook whose rendered URL leaves the saved hooks origin is refused before any request" */
  it.each([
    ["https:///{{ params.host }}/hooks", "https:///attacker.test/hooks"],
    ["https:/\\{{ params.host }}/hooks", "https:/\\attacker.test/hooks"],
    ["https://{{ params.host }}/hooks", "https://attacker.test/hooks"],
    ["{{ params.base }}/hooks", "https://attacker.test/hooks"],
  ])("refuses %j, whose origin a template chooses", (hooksUrl, rendered) => {
    expect(hookOriginRefusal({ hooksUrl, rendered })).toMatch(/hooks URL.*host/i);
  });

  /** @scenario "A hook whose rendered URL leaves the saved hooks origin is refused before any request" */
  it("refuses a rendered URL when the saved password is a template", () => {
    expect(
      hookOriginRefusal({
        hooksUrl: "https://user:{{ params.password }}@shop.example.com/hooks",
        rendered: "https://user:secret@shop.example.com/hooks",
      }),
    ).toMatch(/hooks URL.*host/i);
  });

  it("accepts a rendered URL when the saved password is static", () => {
    expect(
      hookOriginRefusal({
        hooksUrl: "https://user:pw@shop.example.com/hooks",
        rendered: "https://user:pw@shop.example.com/hooks",
      }),
    ).toBeNull();
  });

  it("refuses a rendered URL on another origin than the saved one", () => {
    expect(
      hookOriginRefusal({
        hooksUrl: "https://shop.example.com/hooks",
        rendered: "https://attacker.test/hooks",
      }),
    ).toMatch(/hooks URL.*host/i);
  });
});

describe("plainHttpHookRefusal()", () => {
  const destination = (protocol: string, address: Partial<SsrfValidationResult>) =>
    ({
      originalUrl: `${protocol}//receiver/hooks`,
      hostname: "receiver",
      port: protocol === "https:" ? 443 : 80,
      protocol,
      path: "/hooks",
      type: "resolved",
      resolvedIp: "93.184.216.34",
      ...address,
    }) as SsrfValidationResult;

  /** @scenario "Plain http reaches a hooks URL only at a local address where local addresses are allowed" */
  it.each([
    ["a loopback address", { resolvedIp: "127.0.0.1" }],
    ["a private address", { resolvedIp: "10.0.0.5" }],
    ["an IPv6 loopback", { resolvedIp: "::1" }],
    ["a host the operator allowlisted", { type: "allowlisted", resolvedIp: undefined }],
  ] as const)("admits plain http to %s", (_name, address) => {
    expect(plainHttpHookRefusal(destination("http:", address))).toBeNull();
  });

  it.each([
    ["a public address", { resolvedIp: "93.184.216.34" }],
    ["a name that did not resolve", { type: "unresolved", reason: "dns-failed" }],
  ] as const)("refuses plain http to %s, naming https", (_name, address) => {
    expect(plainHttpHookRefusal(destination("http:", address))).toMatch(/https/);
  });

  it("leaves https alone", () => {
    expect(plainHttpHookRefusal(destination("https:", {}))).toBeNull();
  });
});

describe("withoutReservedHookHeaders()", () => {
  it("drops any spelling of the signature and key headers, and keeps the rest", () => {
    expect(
      withoutReservedHookHeaders({
        "x-langwatch-signature": "t=1,v1=forged",
        "X-LANGWATCH-SIGNATURE": "t=2,v1=forged",
        "idempotency-key": "mine",
        Authorization: "Bearer tok",
      }),
    ).toEqual({ Authorization: "Bearer tok" });
  });
});

describe("readCappedBody()", () => {
  it("reads a body under the cap whole", async () => {
    expect(await readCappedBody({ stream: streamOf(['{"a":', "1}"]), maxBytes: 100 })).toEqual({
      text: '{"a":1}',
      overCap: false,
    });
  });

  describe("when the body streams past the cap", () => {
    /** @scenario "An HTTP hook answer over the state cap is cut off while it is read" */
    it("stops reading at the cap and cancels the rest", async () => {
      const stream = streamOf(["12345", "67890", "never read"]);

      const read = await readCappedBody({ stream, maxBytes: 8 });

      expect(read).toEqual({ text: "12345678", overCap: true });
      expect(stream.cancelled).toBe(true);
      expect(stream.pulled).toBe(2);
    });
  });
});

describe("scrubbedObject()", () => {
  it("scrubs every string, nested ones and keys included, and keeps other values", () => {
    const scrub = (text: string) => text.split("tok_live").join("[REDACTED]");

    expect(
      scrubbedObject(
        { token: "tok_live", nested: { list: ["a tok_live b", 3] }, tok_live: true },
        scrub,
      ),
    ).toEqual({ token: "[REDACTED]", nested: { list: ["a [REDACTED] b", 3] }, "[REDACTED]": true });
  });
});

describe("hookRequestBody()", () => {
  /** @scenario "An HTTP hook call carries the run's idempotency key" */
  it("gives setup no state and teardown the state, and carries the key under the signature", () => {
    const state = { customerId: "c_1" };

    expect(
      JSON.parse(hookRequestBody({ kind: "setup", run, idempotencyKey, params: {}, state })),
    ).toEqual({ kind: "setup", run, idempotencyKey, params: {} });
    expect(
      JSON.parse(hookRequestBody({ kind: "teardown", run, idempotencyKey, params: {}, state })),
    ).toEqual({ kind: "teardown", run, idempotencyKey, params: {}, state });
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

    it("fails a body that was cut at the cap while it was read", () => {
      expect(() =>
        hookAnswer({ kind: "setup", status: 200, body: '{"a":1}', overCap: true }),
      ).toThrow("The setup hook answered more than 7 bytes, over the 65536-byte cap.");
    });

    it("fails a non-JSON body over the cap on the size, before it is parsed", () => {
      const body = "z".repeat(70 * 1024);

      expect(() => hookAnswer({ kind: "setup", status: 200, body })).toThrow(/cap/);
    });
  });
});
