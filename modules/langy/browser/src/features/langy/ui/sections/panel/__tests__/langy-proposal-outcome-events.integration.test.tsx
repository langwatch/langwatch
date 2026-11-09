import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * @vitest-environment jsdom
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */
import { useLangyStore } from "../../../../../../behavior/langy.store.ts";
import {
  RecordingAnalyticsProvider,
  RecordingUiAnalytics,
} from "../../../../__tests__/recording-analytics.test-helpers.tsx";
import type { LangyProposal, ProposalHandlers } from "../../langy-proposal-card.tsx";
import { useLangyProposalApply } from "../use-langy-panel-offers.ts";

const tracked = new RecordingUiAnalytics();

const proposal = (kind: string): LangyProposal => ({
  langyProposal: true,
  kind,
  summary: "Rename the prompt to Acme support bot",
  destructive: false,
  payload: { name: "Acme support bot" },
});

function render(handlers: ProposalHandlers) {
  const { result } = renderHook(
    () => useLangyProposalApply({ proposalHandlersRef: { current: handlers } }),
    {
      wrapper: ({ children }) => (
        <RecordingAnalyticsProvider analytics={tracked}>{children}</RecordingAnalyticsProvider>
      ),
    },
  );
  return result;
}

beforeEach(() => {
  tracked.events.length = 0;
  useLangyStore.setState({
    appliedOutcomes: {},
    discardedProposalIds: new Set(),
    applyingProposalIds: new Set(),
  });
});

describe("useLangyProposalApply", () => {
  describe("given a proposal the page has a handler for", () => {
    /** @scenario "Telemetry: applying or discarding a Langy proposal sends its outcome by kind" */
    it("sends one langy.applied.proposal with its kind once the page carried it out", async () => {
      const result = render({ "prompt.update": vi.fn().mockResolvedValue({}) });

      await act(() => result.current.apply("p1", proposal("prompt.update")));
      await act(() => result.current.apply("p1", proposal("prompt.update")));

      expect(tracked.events).toEqual([
        {
          boundary: "langy",
          action: "applied",
          name: "proposal",
          attributes: { kind: "prompt.update" },
        },
      ]);
    });

    /** @scenario "Telemetry: applying or discarding a Langy proposal sends its outcome by kind" */
    it("sends nothing when the page fails to carry it out", async () => {
      const result = render({ "prompt.update": vi.fn().mockRejectedValue(new Error("denied")) });

      await act(() => result.current.apply("p1", proposal("prompt.update")));

      expect(tracked.events).toEqual([]);
    });

    /** @scenario "Telemetry: applying or discarding a Langy proposal sends its outcome by kind" */
    it("sends one langy.discarded.proposal with its kind, and nothing for a second click", () => {
      const result = render({ "prompt.update": vi.fn() });

      act(() => result.current.discard("p1", proposal("prompt.update")));
      act(() => result.current.discard("p1", proposal("prompt.update")));

      expect(tracked.events).toEqual([
        {
          boundary: "langy",
          action: "discarded",
          name: "proposal",
          attributes: { kind: "prompt.update" },
        },
      ]);
    });
  });

  describe("given a kind no handler on the page knows", () => {
    /** @scenario "Telemetry: applying or discarding a Langy proposal sends its outcome by kind" */
    it("sends the discard as kind other, never the model's text", () => {
      const result = render({});

      act(() => result.current.discard("p1", proposal("rename it to Acme")));

      expect(tracked.events).toEqual([
        {
          boundary: "langy",
          action: "discarded",
          name: "proposal",
          attributes: { kind: "other" },
        },
      ]);
      expect(JSON.stringify(tracked.events)).not.toContain("Acme");
    });
  });
});
