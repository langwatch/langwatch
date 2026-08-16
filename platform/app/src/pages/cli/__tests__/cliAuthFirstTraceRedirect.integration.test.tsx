/**
 * @vitest-environment jsdom
 *
 * Covers specs/ai-governance/cli-onboarding/post-login-first-trace-redirect.feature.
 *
 * The real /cli/auth page runs here: the real approval flow, the real
 * useOrganizationTeamProject, the real FirstTraceRedirect watcher. Only the
 * network boundary is replaced: `fetch` answers like the CLI auth REST
 * endpoints, and the tRPC hooks resolve fixtures, with getHasFirstMessage
 * backed by a store the test flips to simulate the first trace landing.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchMock,
  sessionRef,
  firstMessageState,
  credentialTypeRef,
  lastFirstMessageQueryOptions,
} = vi.hoisted(() => {
  const fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const listeners = new Set<() => void>();
  return {
    fetchMock,
    lastFirstMessageQueryOptions: {
      current: undefined as
        | { enabled?: boolean; refetchIntervalInBackground?: boolean }
        | undefined,
    },
    sessionRef: {
      current: {
        data: { user: { id: "user-1", email: "dev@example.com" } },
        status: "authenticated" as const,
      },
    },
    credentialTypeRef: {
      current: "device_session" as "device_session" | "project_api_key",
    },
    firstMessageState: {
      value: false,
      listeners,
      set(value: boolean) {
        this.value = value;
        for (const listener of listeners) listener();
      },
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      snapshot: () => firstMessageState.value,
    },
  };
});

vi.mock("~/utils/auth-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/utils/auth-client")>();
  return { ...actual, useSession: () => sessionRef.current };
});

const organizationsFixture = [
  {
    id: "org-1",
    name: "Acme Org",
    teams: [
      {
        id: "team-personal",
        slug: "personal-team",
        name: "Personal",
        isPersonal: true,
        ownerUserId: "user-1",
        projects: [
          {
            id: "proj-personal",
            slug: "personal-proj",
            name: "Personal project",
            isPersonal: true,
            kind: "application",
          },
        ],
      },
      {
        id: "team-shared",
        slug: "shared-team",
        name: "Engineering",
        isPersonal: false,
        ownerUserId: null,
        projects: [
          {
            id: "proj-shared",
            slug: "shared-proj",
            name: "Shared project",
            isPersonal: false,
            kind: "application",
          },
        ],
      },
    ],
  },
];

vi.mock("~/utils/api", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    api: {
      publicEnv: {
        useQuery: () => ({ data: {}, isLoading: false }),
      },
      sharedTrace: {
        get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      },
      organization: {
        getAll: {
          useQuery: () => ({
            data: organizationsFixture,
            isLoading: false,
            isFetched: true,
          }),
        },
      },
      modelProvider: {
        getAllForProject: {
          useQuery: () => ({ data: undefined, isLoading: false }),
        },
      },
      project: {
        getHasFirstMessage: {
          useQuery: (
            _input: { projectId: string },
            options?: {
              enabled?: boolean;
              refetchIntervalInBackground?: boolean;
            },
          ) => {
            lastFirstMessageQueryOptions.current = options;
            const value = useSyncExternalStore(
              (listener) => firstMessageState.subscribe(listener),
              () => firstMessageState.value,
            );
            if (options?.enabled === false) {
              return { data: undefined, isLoading: false };
            }
            return { data: { firstMessage: value }, isLoading: false };
          },
        },
      },
    },
  };
});

import { useRouter } from "~/utils/compat/next-router";
import CliAuthPage from "../auth";

const mockRouter = useRouter();

const serveCliAuthEndpoints = () => {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/auth/cli/lookup")) {
      return new Response(
        JSON.stringify({
          user_code: "WDJB-MJHT",
          status: "pending",
          expires_at: Date.now() + 10 * 60_000,
          credential_type: credentialTypeRef.current,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/api/auth/cli/approve")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
};

const renderPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <CliAuthPage />
    </ChakraProvider>,
  );

describe("/cli/auth first-trace watch", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    (mockRouter.push as unknown as Mock).mockClear();
    (mockRouter.replace as unknown as Mock).mockClear();
    mockRouter.query = { user_code: "WDJB-MJHT" };
    credentialTypeRef.current = "device_session";
    firstMessageState.value = false;
    serveCliAuthEndpoints();
  });

  afterEach(() => {
    cleanup();
    mockRouter.query = {};
  });

  const approveDeviceSession = async () => {
    const user = userEvent.setup();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Approve" })).toBeDefined(),
    );
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(screen.getByText(/You're signed in!/i)).toBeDefined(),
    );
  };

  /** @scenario "Approving a device session before any trace has synced waits and then redirects to the personal traces page" */
  /** @scenario "First-trace polling only runs while the page is visible and stops at the timeout" */
  it("waits for the first trace, then redirects to the personal traces page", async () => {
    renderPage();
    await approveDeviceSession();

    await waitFor(() =>
      expect(screen.getByText(/Waiting for your first trace/i)).toBeDefined(),
    );
    expect(mockRouter.push).not.toHaveBeenCalled();

    // Visible-tab-only polling rides react-query's default: the component
    // must never override refetchIntervalInBackground.
    expect(
      lastFirstMessageQueryOptions.current?.refetchIntervalInBackground,
    ).toBeUndefined();

    act(() => firstMessageState.set(true));

    await waitFor(() =>
      expect(screen.getByText(/First trace received/i)).toBeDefined(),
    );
    await waitFor(
      () =>
        expect(mockRouter.push).toHaveBeenCalledWith("/personal-proj/traces"),
      { timeout: 4_000 },
    );
  });

  /** @scenario "Approving a device session when the personal project already has traces keeps the plain success card" */
  it("keeps the plain success card when traces already exist", async () => {
    firstMessageState.value = true;
    renderPage();
    await approveDeviceSession();

    // Give the redirect delay window time to elapse before asserting nothing
    // happened: an already-synced project must keep the close-this-tab card.
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    expect(screen.queryByText(/Waiting for your first trace/i)).toBeNull();
    expect(screen.queryByText(/First trace received/i)).toBeNull();
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(screen.getByText(/You're signed in!/i)).toBeDefined();
  });

  /** @scenario "Sending a project API key keeps the success card still, with no waiting line and no redirect" */
  it("does not watch for traces on the project API key flow", async () => {
    credentialTypeRef.current = "project_api_key";
    renderPage();

    const user = userEvent.setup();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Send API key" }),
      ).toBeDefined(),
    );
    await user.click(screen.getByRole("button", { name: "Send API key" }));
    await waitFor(() =>
      expect(screen.getByText(/API key approved/i)).toBeDefined(),
    );

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(screen.queryByText(/Waiting for your first trace/i)).toBeNull();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});
