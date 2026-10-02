/**
 * @vitest-environment jsdom
 *
 * A hidden tab keeps reading a turn in flight: the cards that wait on the person and the
 * turn it reattaches to both follow this read, and they are what a notification is about.
 * @see specs/langy/langy-notifications.feature
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useLangyMessages } from "../../../behavior/data/use-langy-messages.ts";

const queryOptions = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project_1" } }),
}));

vi.mock("../../../../../behavior/langy-api.ts", () => ({
  api: {
    langy: {
      messages: {
        useQuery: (_input: unknown, options: Record<string, unknown>) => {
          queryOptions.last = options;
          return {
            data: undefined,
            isLoading: false,
            isFetching: false,
            isError: false,
            isSuccess: false,
            error: null,
            refetch: vi.fn(),
          };
        },
      },
    },
  },
}));

vi.mock("../../../../../behavior/langy.store.ts", () => ({
  useLangyStore: { getState: () => ({ confirmConversation: vi.fn() }) },
}));

describe("useLangyMessages", () => {
  describe("when the tab is hidden while a turn is in flight", () => {
    /** @scenario "A card that comes up while the tab is hidden still reaches it" */
    it("keeps polling the conversation in the background", () => {
      renderHook(() => useLangyMessages("langyconv_1"));

      expect(queryOptions.last?.refetchIntervalInBackground).toBe(true);
    });
  });
});
