/**
 * @vitest-environment jsdom
 * Developer mode puts the raw tool payload behind a capability card.
 * Mocks: host, tRPC, router, hydration hook, recharts' ResponsiveContainer.
 * Spec: specs/langy/langy-capability-cards.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { toCliToolResult } from "@langwatch/langy-contract";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cloneElement, type ReactElement } from "react";
import type * as rechartsModule from "recharts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LangyHostApi,
  LangyHostProvider,
  type LangyHostOrganization,
  type LangyHostProject,
  type LangyHostTeam,
  type LangyRouteReading,
} from "../../../../../model/langy-host.ts";

class FakeLangyHost extends LangyHostApi {
  project(): LangyHostProject | undefined {
    return { id: "p_demo", slug: "demo", name: "demo" };
  }
  organization(): LangyHostOrganization | undefined {
    return { id: "org-1" };
  }
  team(): LangyHostTeam | undefined {
    return { id: "team-1" };
  }
  organizationRole() {
    return "MEMBER";
  }
  currentUser() {
    return { id: "user-1", email: "staff@langwatch.ai" };
  }
  hasPermission() {
    return true;
  }
  isLoading() {
    return false;
  }
  isDemoProject() {
    return false;
  }
  featureFlag() {
    return true;
  }
  route(): LangyRouteReading {
    return { params: {}, query: {}, pathname: "/" };
  }
  setQuery() {}
  navigate() {}
  planManagementUrl() {
    return undefined;
  }
  succeeded() {}
  failed() {}
}
const host = new FakeLangyHost();

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../../../../../behavior/langy-api.ts", () => ({
  api: {
    dashboards: {
      getAll: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    graphs: { create: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
  },
}));

vi.mock("../../../behavior/use-capability-data.ts", () => ({
  useCapabilityData: () => ({
    status: "idle",
    rows: [],
    loadedCount: 0,
    totalCount: null,
    isHydrating: false,
  }),
}));

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof rechartsModule>();
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>;
    }) => cloneElement(children, { width: 640, height: 200 }),
  };
});

vi.mock("../../../../../behavior/use-langy-dev-mode.ts", () => ({
  useLangyDevMode: () => [true, vi.fn()],
}));

import { LangyToolActivity } from "../langy-tool-activity.tsx";

afterEach(cleanup);

function renderSettledCard() {
  const payload = { data: [{ name: "golden-set" }], pagination: { total: 1 } };
  const message = {
    id: "assistant-1",
    role: "assistant" as const,
    parts: [
      {
        type: "tool-langwatch.dataset.list",
        toolCallId: "call-1",
        state: "output-available",
        input: { command: "langwatch dataset list" },
        output: JSON.stringify(payload),
        result: toCliToolResult({ resource: "dataset", verb: "list", payload }),
      } as never,
    ],
  };
  return render(
    <DesignSystemProvider forcedTheme="light">
      <LangyHostProvider value={host}>
        <LangyToolActivity message={message} live={false} />
      </LangyHostProvider>
    </DesignSystemProvider>,
  );
}

describe("given developer mode is on and a capability card is drawn", () => {
  describe("when the reader asks for the raw data", () => {
    /** @scenario "Developer mode exposes the raw payload behind every card" */
    it("reveals the tool payload behind the card", async () => {
      const user = userEvent.setup();
      const { container } = renderSettledCard();

      expect(screen.getByText("golden-set")).toBeTruthy();
      expect(container.textContent).not.toContain("output-available");

      await user.click(screen.getByRole("button", { name: "Show raw data" }));

      expect(container.textContent).toContain("output-available");
      expect(container.textContent).toContain("langwatch dataset list");
    });
  });
});
