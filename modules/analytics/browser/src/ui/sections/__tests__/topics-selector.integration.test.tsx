/**
 * @vitest-environment jsdom
 * The topics filter: ticking topics and subtopics writes them to the address.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../testing.tsx";

vi.mock("../../../behavior/analytics-api.ts", () => ({
  analyticsApi: {
    traces: {
      getTopicCounts: {
        useQuery: () => ({
          isLoading: false,
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
        }),
      },
    },
  },
}));

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
