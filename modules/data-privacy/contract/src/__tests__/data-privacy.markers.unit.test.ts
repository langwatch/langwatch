import { describe, expect, it } from "vitest";

import { PRIVACY_PII_INCOMPLETE_MARKER_ATTR } from "../data-privacy.markers.ts";

/**
 * Spec: modules/data-privacy/specs/span-pii-redaction.feature
 * Literal pin of marker attribute name against platform/app's write path.
 * Mismatch means spans appear fully scrubbed when only partly redacted.
 */
describe("given the marker a partly-completed strict pass leaves behind", () => {
  /** @scenario "The marker for an incomplete strict pass is the one the read path looks for" */
  it("is the attribute name the read path looks for", () => {
    expect(PRIVACY_PII_INCOMPLETE_MARKER_ATTR).toBe("langwatch.privacy.pii_incomplete");
  });
});
