/**
 * Main's per-project studio cache key, sent to the engine only when salted.
 *
 * @see modules/workflow/specs/studio-lambda-stream.feature
 */
import { createHash } from "node:crypto";

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { S3_CACHE_KEY_HEADER, s3CacheKeyFor, s3CacheKeyHeaders } from "../s3-cache-key.rules.ts";

const now = Temporal.Instant.from("2026-10-09T12:00:00Z");

describe("s3CacheKeyFor", () => {
  /** @scenario "A salted deployment sends the engine a monthly per-project cache key" */
  it("matches main's hash of project, salt and month", () => {
    const expected = createHash("sha256")
      .update("project-1-pepper-2026-10")
      .digest("base64")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 16)
      .toLowerCase();

    const key = s3CacheKeyFor({ projectId: "project-1", salt: "pepper", now });

    expect(key).toBe(expected);
    expect(key).toMatch(/^[a-z0-9]{16}$/);
  });

  /** @scenario "A salted deployment sends the engine a monthly per-project cache key" */
  it("rotates with the month and differs by project", () => {
    const october = s3CacheKeyFor({ projectId: "project-1", salt: "pepper", now });

    expect(
      s3CacheKeyFor({
        projectId: "project-1",
        salt: "pepper",
        now: Temporal.Instant.from("2026-11-01T00:00:00Z"),
      }),
    ).not.toBe(october);
    expect(s3CacheKeyFor({ projectId: "project-2", salt: "pepper", now })).not.toBe(october);
  });

  /** @scenario "An unsalted deployment sends no cache key" */
  it("sends no header without a salt", () => {
    expect(s3CacheKeyHeaders({ projectId: "project-1", salt: undefined, now })).toEqual({});
    expect(s3CacheKeyHeaders({ projectId: "project-1", salt: "", now })).toEqual({});
  });

  /** @scenario "A salted deployment sends the engine a monthly per-project cache key" */
  it("names the header main sends", () => {
    expect(Object.keys(s3CacheKeyHeaders({ projectId: "project-1", salt: "pepper", now }))).toEqual(
      [S3_CACHE_KEY_HEADER],
    );
  });
});
