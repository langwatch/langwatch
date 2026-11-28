/** How long a released payload stays in Redis; specs/payload-store-content-addressed.feature. */

import { describe, expect, it } from "vitest";

import {
  BLOB_RECLAIM_SAFETY_MARGIN_SECONDS,
  BLOB_RECLAIM_TTL_THRESHOLD_SECONDS,
  BLOB_RELEASE_GRACE_TTL_SECONDS,
} from "../blobConstants.ts";

describe("released blob lifetime", () => {
  /** @scenario "A released blob is kept only a few minutes past the reclaim safety margin" */
  it("keeps a released blob 15 minutes and reclaims it only after the safety margin", () => {
    expect(BLOB_RELEASE_GRACE_TTL_SECONDS).toBe(15 * 60);
    expect(BLOB_RECLAIM_TTL_THRESHOLD_SECONDS).toBeGreaterThan(0);
    expect(BLOB_RELEASE_GRACE_TTL_SECONDS - BLOB_RECLAIM_TTL_THRESHOLD_SECONDS).toBe(
      BLOB_RECLAIM_SAFETY_MARGIN_SECONDS,
    );
  });
});
