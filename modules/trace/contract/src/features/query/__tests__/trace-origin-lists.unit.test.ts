/**
 * The origins a dashboard query's sources offer and the ones the trace query suggests are the
 * same set, so a new stamped origin is added to both or this fails (dashboards-v2 AC200).
 */
import {
  KNOWN_TRACE_ORIGINS,
  OTHER_TRACE_SOURCE,
  TRACE_SOURCES,
} from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { FIELD_VALUES } from "../trace-query-metadata.ts";

describe("given the trace origins LangWatch stamps", () => {
  describe("when the dashboard sources and the trace query's origin values are compared", () => {
    it("names the same origins in both", () => {
      expect([...KNOWN_TRACE_ORIGINS].toSorted()).toEqual(
        [...(FIELD_VALUES.origin ?? [])].toSorted(),
      );
    });

    it("offers every known origin as a source, then other", () => {
      expect(TRACE_SOURCES).toEqual([...KNOWN_TRACE_ORIGINS, OTHER_TRACE_SOURCE]);
    });
  });
});
