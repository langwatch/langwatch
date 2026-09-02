import { describe, expect, it } from "vitest";

import { PRIVACY_PII_INCOMPLETE_MARKER_ATTR } from "../data-privacy.markers";

/**
 * Spec: packages/features/data-privacy/specs/span-pii-redaction.feature
 *
 * A LITERAL pin against the application's
 * `platform/app/src/server/data-privacy/dropKeyCatalog.ts`, which stays as it
 * is while both graphs ingest.
 *
 * The attribute name is the only evidence a strict pass ran and could not
 * finish. A process that stamps one spelling while the read path looks for
 * another does not fail: the drawer simply shows a partly-redacted span as
 * fully scrubbed, which is the one thing this marker exists to prevent.
 */
describe("given the marker a partly-completed strict pass leaves behind", () => {
  /** @scenario "The marker for an incomplete strict pass is the one the read path looks for" */
  it("is the attribute name the read path looks for", () => {
    expect(PRIVACY_PII_INCOMPLETE_MARKER_ATTR).toBe("langwatch.privacy.pii_incomplete");
  });
});
