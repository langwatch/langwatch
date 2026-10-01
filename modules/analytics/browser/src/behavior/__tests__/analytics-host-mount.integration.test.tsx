// @vitest-environment jsdom
/**
 * The mount hard-coded `hasFirstMessage: false`, so every overview led with setup.
 * Spec: modules/analytics/specs/analytics-overview-setup-prompt.feature
 */
import {
  UiCapabilityContextProvider,
  UiScope,
  UiSession,
  type UiActiveScope,
  type UiCapabilities,
} from "@langwatch/browser-host/capabilities";
import type { UiSessionSnapshot } from "@langwatch/browser-host/session";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const PROJECT = { id: "proj-1", slug: "local-dev-project", name: "Local Dev Project" };

const firstMessage = vi.fn((): { data?: { firstMessage: boolean } } => ({}));
vi.mock("../analytics-api.ts", () => ({
  analyticsApi: { project: { getHasFirstMessage: { useQuery: () => firstMessage() } } },
}));

import { useAnalyticsHost } from "../../model/analytics-host.ts";
import AnalyticsHostMount from "../analytics-host-mount.tsx";

class TestScope extends UiScope {
  activeScope(): UiActiveScope {
    return { organizationId: "org-1", projectId: PROJECT.id };
  }
}

class ProjectSession extends UiSession {
  currentUser() {
    return null;
  }

  hasPermission(): boolean {
    return true;
  }

  isSettled(): boolean {
    return true;
  }

  featureFlag(): boolean | undefined {
    return false;
  }

  override snapshot(): UiSessionSnapshot {
    return {
      session: { status: "anonymous", user: null },
      scope: { status: "ready", organization: { id: "org-1" }, team: undefined, project: PROJECT },
      permissions: {
        status: "ready",
        isLoading: false,
        can: () => true,
        canInOrganization: () => true,
      },
    };
  }
}

function Harness({ children }: { children: ReactNode }) {
  const capabilities: UiCapabilities = {
    ...createUiCapabilitiesFromHost(
      { route: () => ({ params: {}, query: {} }), navigate: () => void 0 },
      new ProjectSession(),
    ),
    scope: new TestScope(),
  };
  return (
    <UiCapabilityContextProvider value={capabilities}>
      <AnalyticsHostMount>{children}</AnalyticsHostMount>
    </UiCapabilityContextProvider>
  );
}

/** Stands in for the overview: it reads only whether the project has a first message. */
function FirstMessageReader() {
  const project = useAnalyticsHost().project();
  return <span data-testid="first-message">{String(project?.hasFirstMessage)}</span>;
}

describe("given the analytics host mounted over the project in scope", () => {
  describe("when the project has received a trace", () => {
    /** @scenario "A project that has received traces shows no setup prompt" */
    it("reports its first message", () => {
      firstMessage.mockReturnValue({ data: { firstMessage: true } });

      render(<FirstMessageReader />, { wrapper: Harness });

      expect(screen.getByTestId("first-message")).toHaveTextContent("true");
    });
  });

  describe("when the project has never received a trace", () => {
    /** @scenario "A project that has never received a trace leads with the setup prompt" */
    it("reports no first message", () => {
      firstMessage.mockReturnValue({ data: { firstMessage: false } });

      render(<FirstMessageReader />, { wrapper: Harness });

      expect(screen.getByTestId("first-message")).toHaveTextContent("false");
    });
  });

  describe("when the answer has not arrived", () => {
    /** @scenario "The setup prompt does not flash while the answer is loading" */
    it("does not report a missing first message", () => {
      firstMessage.mockReturnValue({});

      render(<FirstMessageReader />, { wrapper: Harness });

      expect(screen.getByTestId("first-message")).toHaveTextContent("true");
    });
  });
});
