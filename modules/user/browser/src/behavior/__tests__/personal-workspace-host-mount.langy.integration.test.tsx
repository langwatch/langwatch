// @vitest-environment jsdom
/**
 * The /me "Explore via Langy" item reads this port; the mount lends Langy's ask.
 * Spec: modules/user/specs/user.feature
 */
import {
  UiCapabilityContextProvider,
  UiScope,
  UiHostServiceProvider,
  UiSession,
  type UiActiveScope,
  type UiActor,
  type UiCapabilities,
} from "@langwatch/browser-host/capabilities";
import { UiFlagsService } from "@langwatch/browser-host/feature-flag";
import { defineSlice } from "@langwatch/browser-host/global-store";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import {
  LANGY_ABSENT_SURFACE,
  LANGY_STORE_SLICE,
  type LangySliceSurface,
} from "@langwatch/langy-contract";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../personal-workspace-api.ts", () => ({
  personalWorkspaceApi: { organization: { getScopeGraph: { useQuery: () => ({ data: [] }) } } },
}));

import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host.ts";
import PersonalWorkspaceHostMount from "../personal-workspace-host-mount.tsx";

const asked: string[] = [];
defineSlice<LangySliceSurface>({
  name: LANGY_STORE_SLICE,
  create: () => ({ ...LANGY_ABSENT_SURFACE, askLangy: (prompt) => void asked.push(prompt) }),
});

class LangySession extends UiSession {
  constructor(private readonly grant: { permission: boolean; rolledOut: boolean }) {
    super();
  }

  currentUser(): UiActor {
    return { id: "user-1", name: null, email: null, image: null };
  }

  hasPermission(permission: string): boolean {
    return this.grant.permission && permission === "langy:create";
  }

  isSettled(): boolean {
    return true;
  }

  featureFlag(): undefined {
    return void 0;
  }
}

class TestScope extends UiScope {
  activeScope(): UiActiveScope {
    return { organizationId: "org-1", projectId: "proj-personal" };
  }
}

function renderWith(grant: { permission: boolean; rolledOut: boolean }) {
  const capabilities: UiCapabilities = {
    ...createUiCapabilitiesFromHost(
      { route: () => ({ params: {}, query: {} }), navigate: () => void 0 },
      new LangySession(grant),
    ),
    scope: new TestScope(),
    deployment: {
      isDevelopment: false,
      isSaaS: true,
      appBaseUrl: "https://app.langwatch.test",
      hasNlpService: true,
      hasLangevals: true,
      hasEmailProvider: false,
      emailPasswordEnabled: true,
      hasCloudOps: false,
    },
  };
  function Harness({ children }: { children: ReactNode }) {
    return (
      <UiCapabilityContextProvider value={capabilities}>
        <UiHostServiceProvider
          value={new Map([[UiFlagsService.name, { flag: () => grant.rolledOut }]])}
        >
          <PersonalWorkspaceHostMount>{children}</PersonalWorkspaceHostMount>
        </UiHostServiceProvider>
      </UiCapabilityContextProvider>
    );
  }
  render(<AssistantReader />, { wrapper: Harness });
}

function AssistantReader() {
  const host = usePersonalWorkspaceHost();
  return (
    <div>
      <span data-testid="can-ask">{String(host.canAskAssistant())}</span>
      <button onClick={() => host.askAssistant("Where did my tokens go?")}>ask</button>
    </div>
  );
}

afterEach(() => {
  asked.length = 0;
});

describe("given the personal workspace host on /me", () => {
  describe("when the reader may start a Langy turn where Langy is rolled out", () => {
    /** @scenario "A reader who may start a Langy turn is offered Explore via Langy on /me" */
    it("offers the ask and hands the prompt to Langy", () => {
      renderWith({ permission: true, rolledOut: true });

      expect(screen.getByTestId("can-ask")).toHaveTextContent("true");
      fireEvent.click(screen.getByRole("button", { name: "ask" }));
      expect(asked).toEqual(["Where did my tokens go?"]);
    });
  });

  describe("when the reader lacks the grant or Langy is not rolled out", () => {
    /** @scenario "A reader who may not start a Langy turn is not offered Explore via Langy on /me" */
    it.each([
      { permission: false, rolledOut: true },
      { permission: true, rolledOut: false },
    ])("withholds the ask (%o)", (grant) => {
      renderWith(grant);

      expect(screen.getByTestId("can-ask")).toHaveTextContent("false");
    });
  });
});
