/**
 * Comfortable density is the default a fresh profile lands on — its section
 * set decides what's filterable with zero configuration. Feedback events
 * (thumbs_up_down and friends) must be in that set. See
 * specs/traces-v2/search.feature, Rule "Event filtering is reachable on the
 * default sidebar".
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_DENSITY } from "../../../../../behavior/density.store";
import {
  COMFORTABLE_DEFAULT_SECTIONS,
  EVENT_ATTRIBUTES_SECTION_KEY,
  SPAN_ATTRIBUTES_SECTION_KEY,
} from "../../../../../behavior/facet-constants";

describe("comfortable density defaults", () => {
  it("is the density a fresh profile starts on", () => {
    expect(DEFAULT_DENSITY).toBe("comfortable");
  });

  /** @scenario "Event name and Event attributes sections show on the comfortable default" */
  it("includes the event facet and the event-attributes section", () => {
    expect(COMFORTABLE_DEFAULT_SECTIONS).toContain("event");
    expect(COMFORTABLE_DEFAULT_SECTIONS).toContain(
      EVENT_ATTRIBUTES_SECTION_KEY,
    );
  });

  /** @scenario "Span attributes stays behind the facet picker on comfortable density" */
  it("keeps span attributes behind the facet picker", () => {
    expect(COMFORTABLE_DEFAULT_SECTIONS).not.toContain(
      SPAN_ATTRIBUTES_SECTION_KEY,
    );
  });
});
