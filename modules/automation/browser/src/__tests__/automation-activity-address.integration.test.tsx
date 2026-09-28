/**
 * @vitest-environment jsdom
 * Main's `/automations/activity` re-rendered the overview page, whose recent
 * activity is what the address names. The declaration answers it the same way.
 */

import { cleanup, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../behavior/automation-api.ts", () => {
  const emptyQuery = { data: undefined, isLoading: false, isFetching: false, error: null };
  const node = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "useQuery") return () => emptyQuery;
          if (property === "useMutation") return () => ({ mutate: () => {}, isPending: false });
          if (property === "invalidate") return () => {};
          return node();
        },
      },
    );
  const api = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "useUtils") return () => node();
        return node();
      },
    },
  );
  return { api, automationApi: api };
});

import { automationWeb } from "../automation.web.ts";
import { fakeAutomationHost, renderWithAutomationHost } from "../testing.tsx";

afterEach(cleanup);

async function loadScreen(page: string): Promise<ComponentType> {
  const loaded = await automationWeb.installation.screens[page]?.load?.();
  const component = (loaded as { default?: ComponentType } | undefined)?.default;
  if (!component) throw new Error(`${page} declares no screen`);
  return component;
}

describe("given the automations activity address", () => {
  describe("when the browser opens it", () => {
    it("renders the overview with its recent activity, as main did", async () => {
      const ActivityScreen = await loadScreen("pages/[project]/automations/activity");

      renderWithAutomationHost(<ActivityScreen />, { host: fakeAutomationHost() });

      expect(await screen.findByText("Recent activity")).toBeTruthy();
    });
  });
});
