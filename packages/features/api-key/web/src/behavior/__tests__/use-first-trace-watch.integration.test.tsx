/**
 * @vitest-environment jsdom
 *
 * The post-approval first-trace watch, driven end to end.
 *
 * The policy it applies is pure and has its own unit suite; what this file is
 * about is the two things only a render can say: that a project which already
 * has traces keeps the plain close-this-tab card, and that a first trace landing
 * takes the reader to their own session — through the HOST, never through a
 * router the screen reached for.
 *
 * Restated from `platform/app/src/pages/cli/__tests__/cliAuthFirstTraceRedirect.integration.test.tsx`,
 * which drove the whole `/cli/auth` page to reach this component. Here the
 * component is driven directly, which is what makes the timers legible: the
 * platform suite had to approve a device code first, and every timing question
 * was tangled with the approval's.
 *
 * Spec: specs/ai-governance/cli-onboarding/post-login-first-trace-redirect.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeyHostProvider } from "../../model/api-key-host";
import { FIRST_TRACE_REDIRECT_DELAY_MS } from "../../model/first-trace-policy";
import { FakeApiKeyHost } from "../../testing";
import { FirstTraceRedirect } from "../../ui/sections/first-trace-redirect";

const { state } = vi.hoisted(() => ({
  state: {
    firstMessage: void 0 as boolean | undefined,
    lastOptions: void 0 as Record<string, unknown> | undefined,
  },
}));

vi.mock("../api-key-api", () => ({
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
    <ChakraProvider value={defaultSystem}>
      <ApiKeyHostProvider value={host}>
        <FirstTraceRedirect />
      </ApiKeyHostProvider>
    </ChakraProvider>
  );
}

function renderWatch(host: FakeApiKeyHost) {
  return render(watchElement(host));
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

    /** @scenario First-trace polling only runs while the page is visible and stops at the timeout */
    it("never overrides react-query's own visible-tab-only interval behaviour", async () => {
      const host = new FakeApiKeyHost({ organizations: ORGANIZATIONS });
      state.firstMessage = false;
      renderWatch(host);
      await screen.findByText(/Waiting for your first trace/);
      // Leaving `refetchIntervalInBackground` unset is what stops the watch
      // polling a hidden tab. Setting it — in either direction — is the change
      // this pins.
      expect(state.lastOptions).toBeDefined();
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
