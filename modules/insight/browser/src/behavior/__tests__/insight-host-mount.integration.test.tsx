// @vitest-environment jsdom
/**
 * The mount opens a Langy conversation by writing the address back. A click answers late, so the
 * query it writes is the one the address holds then, not the route reading of an older render.
 * @see modules/insight/specs/insight-actions.feature
 */
import { UiHostServicesContextProvider, UiSession } from "@langwatch/browser-host/capabilities";
import type { UiSessionSnapshot } from "@langwatch/browser-host/session";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import { LANGY_CONVERSATION_PARAM } from "@langwatch/langy-contract";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useInsightHost } from "../../model/insight-host.ts";
import InsightHostMount from "../insight-host-mount.tsx";

class SignedOutSession extends UiSession {
  override snapshot(): UiSessionSnapshot {
    return {
      session: { status: "anonymous", user: null },
      scope: { status: "ready", organization: void 0, team: void 0, project: void 0 },
      permissions: {
        status: "ready",
        isLoading: false,
        can: () => false,
        canInOrganization: () => false,
      },
    };
  }

  currentUser() {
    return null;
  }

  hasPermission(): boolean {
    return false;
  }

  isSettled(): boolean {
    return true;
  }
}

/** The host over a route still reading the query of the render the click was made in. */
function hostOverStaleRoute() {
  const written: Readonly<Record<string, string | undefined>>[] = [];
  const capabilities = createUiHostServicesFromHost(
    {
      route: () => ({ params: {}, query: { folder: "kept" } }),
      setQuery: (next) => written.push(next),
      navigate: () => void 0,
    },
    new SignedOutSession(),
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <UiHostServicesContextProvider value={capabilities}>
      <InsightHostMount>{children}</InsightHostMount>
    </UiHostServicesContextProvider>
  );
  return { host: renderHook(() => useInsightHost(), { wrapper }).result.current, written };
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("given an address whose query changed since the click", () => {
  describe("when the conversation opens", () => {
    /** @scenario "Opening the conversation keeps the query the address holds now" */
    it("keeps the query as it is now, and names the conversation", () => {
      window.history.replaceState(null, "", "/acme/insights?folder=archived");
      const { host, written } = hostOverStaleRoute();

      host.openLangyConversation("conversation-1");

      expect(written).toEqual([
        { folder: "archived", [LANGY_CONVERSATION_PARAM]: "conversation-1" },
      ]);
    });
  });
});
