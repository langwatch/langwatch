/**
 * How long a run's key lives and when a held one is handed out again.
 *
 * @see modules/workflow/specs/workflow-service.feature
 */
import { RUN_KEY_LIFETIME_MS } from "@langwatch/api-key-contract";
import { describe, expect, it } from "vitest";

import {
  RUN_KEY_REUSE_MARGIN_MS,
  isRunKeyReusable,
  missingRunPermissions,
  runKeyCacheKey,
  runKeyLifetimeMs,
} from "../run-key.rules.ts";

const LAMBDA_FLOOR_MS = 960_000;

describe("missingRunPermissions", () => {
  it("names what the starter lacks and nothing it holds", () => {
    expect(
      missingRunPermissions({
        needed: ["traces:create", "evaluations:manage"],
        held: ["traces:create", "workflows:manage"],
      }),
    ).toEqual(["evaluations:manage"]);
  });
});

describe("isRunKeyReusable", () => {
  /** @scenario "A long run keeps calling LangWatch past 15 minutes" */
  it("reuses a key while the 5 minute margin remains and mints once it does not", () => {
    const nowMs = 1_000_000;
    const at = (left: number) =>
      isRunKeyReusable({ expiresAtMs: nowMs + left, nowMs, minRemainingMs: undefined });

    expect(at(RUN_KEY_REUSE_MARGIN_MS)).toBe(true);
    expect(at(RUN_KEY_REUSE_MARGIN_MS - 1)).toBe(false);
  });

  /** @scenario "A dispatch never holds a key that lapses before the dispatch can end" */
  it("hands a bounded dispatch only a key that outlives its bound", () => {
    const nowMs = 1_000_000;
    const at = (left: number) =>
      isRunKeyReusable({ expiresAtMs: nowMs + left, nowMs, minRemainingMs: LAMBDA_FLOOR_MS });

    expect(at(LAMBDA_FLOOR_MS)).toBe(true);
    expect(at(LAMBDA_FLOOR_MS - 1)).toBe(false);
  });
});

describe("runKeyLifetimeMs", () => {
  it("is 15 minutes when the caller asks for no more than the margin", () => {
    expect(runKeyLifetimeMs(undefined)).toBe(RUN_KEY_LIFETIME_MS);
  });

  /** @scenario "A dispatch never holds a key that lapses before the dispatch can end" */
  it("outlives a longer bound by the reuse window", () => {
    expect(runKeyLifetimeMs(LAMBDA_FLOOR_MS)).toBe(LAMBDA_FLOOR_MS + RUN_KEY_REUSE_MARGIN_MS);
    expect(runKeyLifetimeMs(RUN_KEY_LIFETIME_MS)).toBe(
      RUN_KEY_LIFETIME_MS + RUN_KEY_REUSE_MARGIN_MS,
    );
  });
});

describe("runKeyCacheKey", () => {
  it("differs by starter, project and permission set, never by permission order", () => {
    const base = { userId: "u1", projectId: "p1", permissions: ["a:b", "c:d"] };

    expect(runKeyCacheKey({ ...base, permissions: ["c:d", "a:b"] })).toBe(runKeyCacheKey(base));
    expect(runKeyCacheKey({ ...base, userId: null })).not.toBe(runKeyCacheKey(base));
    expect(runKeyCacheKey({ ...base, projectId: "p2" })).not.toBe(runKeyCacheKey(base));
    expect(runKeyCacheKey({ ...base, permissions: ["a:b"] })).not.toBe(runKeyCacheKey(base));
  });
});
