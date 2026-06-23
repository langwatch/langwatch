import { describe, expect, it } from "vitest";
import { LENS_CAPABILITIES } from "../../../lens/capabilities";
import type { TraceListItem } from "../../../types/trace";
import {
  type ConversationGroup,
  sortConversationGroups,
} from "../conversationGroups";

/**
 * Regression coverage for the conversation lens sort. `manualSorting` means
 * `sortConversationGroups` is the ONLY ordering path, so every column the
 * capability marks sortable must have a matching accessor — otherwise the
 * sort silently no-ops and the table shows a chevron that doesn't reorder
 * (the `started` / `lastTurn` columns regressed exactly this way).
 */

const stubTrace = {} as unknown as TraceListItem;

function makeGroup(
  id: string,
  overrides: Partial<ConversationGroup> & { turns?: number },
): ConversationGroup {
  const { turns, ...rest } = overrides;
  return {
    conversationId: id,
    traces: Array.from({ length: turns ?? 1 }, () => stubTrace),
    totalDuration: 0,
    totalCost: 0,
    totalTokens: 0,
    totalSpans: 0,
    errorCount: 0,
    totalEvents: 0,
    totalEvals: 0,
    evalsPassedCount: 0,
    evalsFailedCount: 0,
    worstStatus: "ok",
    latestTimestamp: 0,
    earliestTimestamp: 0,
    lastMessage: "",
    lastOutput: "",
    primaryModel: "",
    serviceName: "",
    ...rest,
  };
}

// low / mid / high are built so EVERY sortable dimension increases
// low → mid → high, so a correct ascending sort is always [low, mid, high].
// They're passed scrambled so a no-op accessor leaves them out of order.
const low = makeGroup("low", {
  earliestTimestamp: 100,
  latestTimestamp: 110,
  totalDuration: 10,
  totalCost: 1,
  totalTokens: 100,
  turns: 1,
});
const mid = makeGroup("mid", {
  earliestTimestamp: 200,
  latestTimestamp: 220,
  totalDuration: 20,
  totalCost: 2,
  totalTokens: 200,
  turns: 2,
});
const high = makeGroup("high", {
  earliestTimestamp: 300,
  latestTimestamp: 330,
  totalDuration: 30,
  totalCost: 3,
  totalTokens: 300,
  turns: 3,
});
const scrambled = [mid, high, low];

const ids = (gs: ConversationGroup[]) => gs.map((g) => g.conversationId);

describe("sortConversationGroups", () => {
  const capability = LENS_CAPABILITIES["by-conversation"];

  describe("given every column the conversation lens marks sortable", () => {
    for (const columnId of capability.sortableColumnIds) {
      it(`orders by ${columnId} ascending and descending`, () => {
        const asc = sortConversationGroups({
          groups: scrambled,
          sort: { columnId, direction: "asc" },
        });
        const desc = sortConversationGroups({
          groups: scrambled,
          sort: { columnId, direction: "desc" },
        });
        expect(ids(asc)).toEqual(["low", "mid", "high"]);
        expect(ids(desc)).toEqual(["high", "mid", "low"]);
      });
    }
  });

  describe("when the default conversation sort is applied", () => {
    it("orders by the default column, not the latest-first pre-sort", () => {
      const { columnId, direction } = capability.defaultSort;
      const sorted = sortConversationGroups({
        groups: scrambled,
        sort: { columnId, direction },
      });
      // Default is `started` desc → earliestTimestamp desc = high, mid, low.
      // Previously `started` had no accessor and fell back to latest-first.
      expect(ids(sorted)).toEqual(["high", "mid", "low"]);
    });
  });
});
