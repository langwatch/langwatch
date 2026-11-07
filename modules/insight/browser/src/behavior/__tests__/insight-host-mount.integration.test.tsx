// @vitest-environment jsdom
/**
 * The real click hook over the real mount, and a route that re-reads as its query changes, the way
 * the shell's does: opening a conversation writes the whole query of the latest render.
 * @see modules/insight/specs/insight-actions.feature
 */
import { UiHostServicesContextProvider, UiSession } from "@langwatch/browser-host/capabilities";
import { createUiRoute } from "@langwatch/browser-host/navigation";
import type { UiSessionSnapshot } from "@langwatch/browser-host/session";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import { createUiQueryClient } from "@langwatch/browser/query-client";
import { answeringUiTransport, type UiProcedureCall } from "@langwatch/browser/testing-transport";
import type { InsightActionRun } from "@langwatch/insight-contract";
import { LANGY_CONVERSATION_PARAM } from "@langwatch/langy-contract";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { describe, expect, it } from "vitest";

import { useInsightHost } from "../../model/insight-host.ts";
import { insightApi } from "../insight-api.ts";
import InsightHostMount from "../insight-host-mount.tsx";
import { useRunInsightAction } from "../use-run-insight-action.ts";

type Query = Readonly<Record<string, string | undefined>>;

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

/** The hook inside the mount, on an address holding `query`; each action run waits for the test. */
function renderOnAddress({ query }: { query: Query }) {
  const written: Query[] = [];
  const pendingRuns: ((run: InsightActionRun) => void)[] = [];
  const transport = answeringUiTransport((call: UiProcedureCall) =>
    call.path === "insights.runAction"
      ? new Promise<InsightActionRun>((resolve) => pendingRuns.push(resolve))
      : Promise.reject(new Error(`No test answer for ${call.path}`)),
  );
  const queryClient = createUiQueryClient({ onMutationError: () => void 0 });
  const services = createUiHostServicesFromHost(
    { route: () => ({ params: {}, query: {} }), navigate: () => void 0 },
    new SignedOutSession(),
  );
  const Address = ({ children }: { children: ReactNode }) => {
    const [current, setCurrent] = useState(query);
    const route = createUiRoute({
      values: { params: {}, query: current },
      setQuery: (next) => {
        written.push(next);
        setCurrent(next);
      },
    });
    return (
      <UiHostServicesContextProvider value={{ ...services, route }}>
        <insightApi.Provider client={transport} queryClient={queryClient}>
          <InsightHostMount>{children}</InsightHostMount>
        </insightApi.Provider>
      </UiHostServicesContextProvider>
    );
  };
  const { result } = renderHook(
    () => ({
      host: useInsightHost(),
      clicks: useRunInsightAction(),
    }),
    { wrapper: Address },
  );
  return { result, written, pendingRuns };
}

describe("given an action on its way, and a folder switched since the click", () => {
  describe("when the click answers and the conversation opens", () => {
    /** @scenario "A folder switched while a click is on its way is kept when the conversation opens" */
    it("keeps the folder switched to, and names the conversation", async () => {
      const { result, written, pendingRuns } = renderOnAddress({ query: { folder: "inbox" } });

      act(() =>
        result.current.clicks.run({
          projectId: "project-1",
          insightId: "insight-1",
          actionId: "a0",
        }),
      );
      await waitFor(() => expect(pendingRuns).toHaveLength(1));
      act(() => result.current.host.setQuery({ folder: "archived" }));
      act(() =>
        pendingRuns[0]?.({
          conversationId: "conversation-1",
          turnId: "turn-1",
          sourceGone: false,
          forkNotReady: false,
          forkTitle: null,
        }),
      );

      await waitFor(() =>
        expect(written.at(-1)).toEqual({
          folder: "archived",
          [LANGY_CONVERSATION_PARAM]: "conversation-1",
        }),
      );
    });
  });
});
