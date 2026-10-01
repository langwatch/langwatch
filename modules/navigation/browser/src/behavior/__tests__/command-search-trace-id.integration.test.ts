/**
 * @see specs/traces-v2/default-drawer-routing.feature
 */
import { describe, expect, it, vi } from "vitest";

import { handleSearchResultSelect } from "../../model/command-select-handlers.ts";
import { detectEntityId } from "../use-command-search.ts";

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";

describe("the command bar's trace id search", () => {
  describe("given a trace id typed into the bar", () => {
    /** @scenario A trace ID searched in the command bar opens in the Trace Explorer */
    it("goes to the Trace Explorer with that trace's drawer open", () => {
      const result = detectEntityId({ query: TRACE_ID, projectSlug: "demo" });
      expect(result).not.toBeNull();

      const go = vi.fn();
      handleSearchResultSelect({
        result: result!,
        projectSlug: "demo",
        ctx: { go, newTab: false, close: vi.fn() },
        addRecentItem: vi.fn(),
        openDrawer: vi.fn(),
      });

      expect(go).toHaveBeenCalledWith(
        `/demo/traces?drawer.open=traceV2Details&drawer.traceId=${TRACE_ID}`,
      );
    });
  });
});
