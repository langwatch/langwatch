/**
 * @vitest-environment jsdom
 * The panel draws `langwatch onboarding` results as customer copy.
 * Mocks: host, tRPC, router, hydration hook.
 * Spec: specs/langy/langy-guided-onboarding.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { toCliToolResult } from "@langwatch/langy-contract";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LangyHostApi,
  LangyHostProvider,
  type LangyHostOrganization,
  type LangyHostProject,
  type LangyHostTeam,
  type LangyRouteReading,
} from "../../../../../model/langy-host.ts";

vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));

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
  hasOrganizationPermission() {
    return false;
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

import { LangyToolActivity } from "../langy-tool-activity.tsx";

afterEach(cleanup);

function renderOnboardingCard({
  verb,
  command,
  payload,
}: {
  verb: string;
  command: string;
  payload: unknown;
}) {
  const message = {
    id: "assistant-1",
    role: "assistant" as const,
    parts: [
      {
        type: `tool-langwatch.onboarding.${verb}`,
        toolCallId: "call-1",
        state: "output-available",
        input: { command },
        output: JSON.stringify(payload),
        result: toCliToolResult({ resource: "onboarding", verb, payload }),
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

describe("given Langy ran an onboarding command inside the panel", () => {
  describe("when the path is marked complete", () => {
    /** @scenario The done marker is one line */
    it("reads as the one line and draws no label and value rows", () => {
      renderOnboardingCard({
        verb: "complete-path",
        command: "langwatch onboarding complete-path coding",
        payload: { text: "Coding Agent Tracking set up" },
      });

      expect(screen.getByText("Coding Agent Tracking set up")).toBeDefined();
      expect(screen.queryByText("text")).toBeNull();
    });
  });
});
