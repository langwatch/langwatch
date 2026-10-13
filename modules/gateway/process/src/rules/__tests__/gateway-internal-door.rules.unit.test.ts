import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  answer,
  detectVirtualKeyStatusRejection,
  readJson,
  refuse,
} from "../gateway-internal-door.rules.ts";

const NOW = Temporal.Instant.from("2026-10-06T12:00:00Z");

describe("the internal door envelope", () => {
  it("answers 200 with the body and refuses with the error under `error`", () => {
    expect(answer({ ok: true })).toEqual({ status: 200, body: { ok: true } });
    expect(refuse(404, { type: "not_found", code: "x", message: "m" })).toEqual({
      status: 404,
      body: { error: { type: "not_found", code: "x", message: "m" } },
    });
  });

  it("reads bytes that are not JSON as null", () => {
    expect(readJson("{")).toBeNull();
    expect(readJson('{"a":1}')).toEqual({ a: 1 });
  });
});

describe("detectVirtualKeyStatusRejection", () => {
  it("refuses a revoked, disabled or expired key with its own code, and passes an active one", () => {
    const codes = [
      { status: "REVOKED", expiresAt: null },
      { status: "DISABLED", expiresAt: null },
      { status: "ACTIVE", expiresAt: NOW },
    ].map((key) => detectVirtualKeyStatusRejection({ ...key, now: NOW }));
    expect(codes).toMatchInlineSnapshot(`
      [
        {
          "code": "virtual_key_revoked",
          "message": "virtual key has been revoked",
          "status": 403,
          "type": "virtual_key_revoked",
        },
        {
          "code": "virtual_key_disabled",
          "message": "virtual key is disabled; it can be re-enabled by an administrator",
          "status": 403,
          "type": "virtual_key_disabled",
        },
        {
          "code": "virtual_key_expired",
          "message": "virtual key has expired; extend its expiration or mint a new one",
          "status": 403,
          "type": "virtual_key_expired",
        },
      ]
    `);
    expect(
      detectVirtualKeyStatusRejection({ status: "ACTIVE", expiresAt: null, now: NOW }),
    ).toBeNull();
  });
});
