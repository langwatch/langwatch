/**
 * @vitest-environment jsdom
 * The published filter sidebar's topics filter: ticks write to the router query.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({
  query: {} as Record<string, string | string[] | undefined>,
  pushed: [] as unknown[],
}));

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({
    query: router.query,
    push: (...args: unknown[]) => {
      router.pushed.push(args);
      return Promise.resolve(true);
    },
  }),
}));

vi.mock("@langwatch/analytics-browser-kit", () => ({
  useFilterParams: () => ({ filterParams: { filters: {} }, queryOpts: {} }),
}));

vi.mock("@langwatch/browser-trpc/workflow-api", () => ({
  api: {
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

function mount(query: Record<string, string | string[]>) {
  router.query = query;
  router.pushed = [];
  render(
    <ChakraProvider value={defaultSystem}>
      <TopicsSelector />
    </ChakraProvider>,
  );
  return userEvent.setup();
}

const shallow = [undefined, { shallow: true }];

describe("the published topics filter", () => {
  it("lists topics most counted first, with subtopics only under a ticked topic", () => {
    mount({ topics: ["t1"] });
    const names = screen.getAllByRole("checkbox").map((box) => box.closest("label")?.textContent);
    expect(names).toEqual(["Auth", "Billing", "Refunds", "Invoices"]);
  });

  it("ticking a topic pushes it onto the query", async () => {
    const user = mount({ period: "7d" });
    await user.click(screen.getByRole("checkbox", { name: "Auth" }));
    expect(router.pushed).toEqual([
      [{ query: { period: "7d", topics: "t2", subtopics: undefined } }, ...shallow],
    ]);
  });

  it("ticking a subtopic pushes only the subtopics", async () => {
    const user = mount({ topics: "t1" });
    await user.click(screen.getByRole("checkbox", { name: "Refunds" }));
    expect(router.pushed).toEqual([[{ query: { topics: "t1", subtopics: "s1" } }, ...shallow]]);
  });
});
