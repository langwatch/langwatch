/** How long a released payload stays in Redis; specs/payload-store-content-addressed.feature. */

import { describe, expect, it } from "vitest";

import {
  BLOB_RECLAIM_SAFETY_MARGIN_SECONDS,
  BLOB_RECLAIM_TTL_THRESHOLD_SECONDS,
  BLOB_RELEASE_GRACE_TTL_SECONDS,
} from "../blobConstants.ts";

describe("released blob lifetime", () => {
  /** @scenario "The sweeper reclaims a released blob only in its last five minutes, whatever the window" */
  it("reclaims only with five minutes left and keeps the safety margin before that", () => {
    // One hour until every worker reclaims at five minutes left; then it shortens (ADR-029).
    expect(BLOB_RELEASE_GRACE_TTL_SECONDS).toBe(60 * 60);
    expect(BLOB_RECLAIM_TTL_THRESHOLD_SECONDS).toBe(5 * 60);
    expect(
      BLOB_RELEASE_GRACE_TTL_SECONDS - BLOB_RECLAIM_TTL_THRESHOLD_SECONDS,
    ).toBeGreaterThanOrEqual(BLOB_RECLAIM_SAFETY_MARGIN_SECONDS);
  });
});
