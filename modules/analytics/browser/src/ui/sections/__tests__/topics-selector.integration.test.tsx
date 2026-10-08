/**
 * @vitest-environment jsdom
 * The topics filter: ticking topics and subtopics writes them to the address.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../testing.tsx";

const topicQuery = vi.hoisted(() => ({
  loaded: {
    isLoading: false,
    error: null,
    data: {
      topicCounts: [
        { id: "t1", name: "Billing", count: 3 },
        { id: "t2", name: "Auth", count: 7 },
      ],
      subtopicCounts: [
        { id: "s1", name: "Refunds", count: 2, parentId: "t1" },
        { id: "s2", name: "Invoices", count: 1, parentId: "t1" },
      ],
    },
  } as Record<string, unknown>,
  current: {} as Record<string, unknown>,
}));

vi.mock("../../../behavior/analytics-api.ts", () => ({
  analyticsApi: {
    traces: {
      getTopicCounts: { useQuery: () => topicQuery.current },
    },
  },
}));

beforeEach(() => {
  topicQuery.current = topicQuery.loaded;
});

import { TopicsSelector } from "../topics-selector.tsx";

function mount(query: Record<string, string>) {
  const host = new StubAnalyticsHost({ route: { params: {}, query } });
  render(
    <AnalyticsTestHarness host={host}>
      <TopicsSelector />
    </AnalyticsTestHarness>,
  );
  return { host, user: userEvent.setup() };
}

describe("the topics filter", () => {
  it("lists topics most counted first, with subtopics only under a ticked topic", () => {
    mount({ topics: "t1" });
    const names = screen.getAllByRole("checkbox").map((box) => box.closest("label")?.textContent);
    expect(names).toEqual(["Auth", "Billing", "Refunds", "Invoices"]);
  });

  it("ticking a topic adds it to the address", async () => {
    const { host, user } = mount({ period: "7d" });
    await user.click(screen.getByRole("checkbox", { name: "Auth" }));
    expect(host.queries).toEqual([{ period: "7d", topics: "t2", subtopics: undefined }]);
  });

  it("ticking a subtopic keeps the topics as they are", async () => {
    const { host, user } = mount({ topics: "t1" });
    await user.click(screen.getByRole("checkbox", { name: "Refunds" }));
    expect(host.queries).toEqual([{ topics: "t1", subtopics: "s1" }]);
  });
});

describe("the topics panel", () => {
  describe("when the topic counts query has failed", () => {
    /** @scenario "A failed topics panel shows the error state with a Retry" */
    it("shows the panel error state with a Retry that refetches the topics", async () => {
      const refetch = vi.fn();
      topicQuery.current = {
        isLoading: false,
        data: undefined,
        error: { message: "internal_error", data: { httpStatus: 500 } },
        refetch,
      };
      const { user } = mount({});

      const alert = screen.getByRole("alert");
      expect(within(alert).getByText("Couldn't load topics")).toBeInTheDocument();
      await user.click(within(alert).getByRole("button", { name: /retry/i }));

      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });
});
