/**
 * @vitest-environment jsdom
 *
 * Post-approval first-trace watch: render-only behavior (nav through HOST, not router).
 * Spec: specs/ai-governance/cli-onboarding/post-login-first-trace-redirect.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiKeyHostProvider } from "../../model/api-key-host.ts";
import { FIRST_TRACE_REDIRECT_DELAY_MS } from "../../model/first-trace-policy.ts";
import { FakeApiKeyHost } from "../../testing.tsx";
import { FirstTraceRedirect } from "../../ui/sections/first-trace-redirect.tsx";

const { state } = vi.hoisted(() => ({
  state: {
    firstMessage: void 0 as boolean | undefined,
    lastOptions: void 0 as Record<string, unknown> | undefined,
  },
}));

vi.mock("../api-key-api.ts", () => ({
  apiKeyApi: {
    project: {
      getHasFirstMessage: {
        useQuery: (_input: unknown, options: Record<string, unknown>) => {
          state.lastOptions = options;
          return { data: { firstMessage: state.firstMessage } };
        },
      },
    },
  },
}));

const ORGANIZATIONS = [
  {
    id: "org-1",
    name: "ACME",
    teams: [
      {
        id: "team-personal",
        name: "Jane's Workspace",
        isPersonal: true,
        ownerUserId: "user-1",
        projects: [
          {
            id: "proj-personal",
            name: "Personal Workspace",
            slug: "jane-personal",
            isPersonal: true,
            ownerUserId: "user-1",
          },
        ],
      },
    ],
  },
];

function watchElement(host: FakeApiKeyHost) {
  return (
    <ApiKeyHostProvider value={host}>
      <FirstTraceRedirect />
    </ApiKeyHostProvider>
  );
}

function renderWatch(host: FakeApiKeyHost) {
  return renderWithDesignSystem(watchElement(host));
}

beforeEach(() => {
  state.firstMessage = void 0;
  state.lastOptions = void 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("given a personal project that has never received a trace", () => {
  describe("when the first trace lands", () => {
    /** @scenario Approving a device session before any trace has synced waits and then redirects to the personal traces page */
    it("waits, says so, then takes the reader to their own traces", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const host = new FakeApiKeyHost({ organizations: ORGANIZATIONS });
      state.firstMessage = false;
      const { rerender } = renderWatch(host);

      expect(await screen.findByText(/Waiting for your first trace/)).toBeInTheDocument();

      state.firstMessage = true;
      rerender(watchElement(host));

      expect(await screen.findByText(/First trace received/)).toBeInTheDocument();
      expect(host.navigations).toEqual([]);
      await act(async () => {
        vi.advanceTimersByTime(FIRST_TRACE_REDIRECT_DELAY_MS);
      });
      await waitFor(() =>
        expect(host.navigations).toEqual([{ kind: "navigate", to: "/jane-personal/traces" }]),
      );
    });

    /** @scenario The first-trace watch sets no timer */
    it("sets no refetch timer; a server read hint drives the watch", async () => {
      const host = new FakeApiKeyHost({ organizations: ORGANIZATIONS });
      state.firstMessage = false;
      renderWatch(host);
      await screen.findByText(/Waiting for your first trace/);
      expect(state.lastOptions).toBeDefined();
      expect(state.lastOptions).not.toHaveProperty("refetchInterval");
      expect(state.lastOptions).not.toHaveProperty("refetchIntervalInBackground");
      expect(state.lastOptions!.refetchOnWindowFocus).toBe(false);
    });
  });
});

describe("given a personal project that already has traces", () => {
  /** @scenario Approving a device session when the personal project already has traces keeps the plain success card */
  it("renders nothing at all and never navigates", async () => {
    const host = new FakeApiKeyHost({ organizations: ORGANIZATIONS });
    state.firstMessage = true;
    const { container } = renderWatch(host);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(host.navigations).toEqual([]);
  });
});

describe("given a reader with no personal workspace", () => {
  /** @scenario Sending a project API key keeps the success card still, with no waiting line and no redirect */
  it("has nothing to watch, so it renders nothing", async () => {
    const host = new FakeApiKeyHost({ organizations: [] });
    state.firstMessage = false;
    const { container } = renderWatch(host);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(host.navigations).toEqual([]);
  });
});
