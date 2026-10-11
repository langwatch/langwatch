/**
 * @vitest-environment jsdom
 *
 * Spec: specs/settings/settings-page-chrome.feature
 */

import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, calls } = vi.hoisted(() => ({
  state: {
    rows: [] as Record<string, unknown>[],
    nextCursor: null as { createdAt: Date; id: string } | null,
    isLoading: false,
    isError: false,
  },
  calls: {
    fetchNextPage: vi.fn<() => void>(),
    remove: vi.fn<(input: unknown) => void>(),
    invalidate: vi.fn<() => Promise<void>>().mockResolvedValue(void 0),
  },
}));

vi.mock("../../../behavior/notification-api.ts", () => ({
  notificationApi: {
    useUtils: () => ({
      emailSuppression: { getPage: { invalidate: calls.invalidate } },
    }),
    emailSuppression: {
      getPage: {
        useInfiniteQuery: () => ({
          data: state.isLoading
            ? void 0
            : { pages: [{ suppressions: state.rows, nextCursor: state.nextCursor }] },
          isLoading: state.isLoading,
          isError: state.isError,
          isRefetching: false,
          isFetchingNextPage: false,
          hasNextPage: state.nextCursor !== null,
          fetchNextPage: calls.fetchNextPage,
          refetch: vi.fn<() => void>(),
        }),
      },
      remove: {
        useMutation: (options?: { onSuccess?: () => Promise<void> | void }) => ({
          isPending: false,
          variables: void 0,
          mutate: (input: unknown) => {
            calls.remove(input);
            void options?.onSuccess?.();
          },
        }),
      },
    },
  },
}));

import { FakeNotificationHost, renderWithNotificationHost } from "../../../testing.tsx";
import EmailSuppressionsScreen from "../email-suppressions-screen.tsx";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "sup-1",
  email: "someone@example.com",
  triggerId: null,
  triggerName: null,
  reason: null,
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [row()];
  state.nextCursor = null;
  state.isLoading = false;
  state.isError = false;
});

afterEach(cleanup);

describe("given no project is in scope", () => {
  it("renders nothing rather than a table about nothing", () => {
    const { container } = renderWithNotificationHost(
      <EmailSuppressionsScreen />,
      new FakeNotificationHost({ project: null }),
    );

    expect(container.textContent).toBe("");
  });
});

/** No trigger id means EVERY notification this project sends, said plainly. */
describe("given a recipient who opted out of everything", () => {
  it("says so rather than naming a notification they did not pick", () => {
    renderWithNotificationHost(<EmailSuppressionsScreen />);

    expect(screen.getByText("All notifications")).toBeTruthy();
  });
});

describe("given a recipient who opted out of one notification", () => {
  it("names it", () => {
    state.rows = [row({ triggerId: "trigger-1", triggerName: "Nightly digest" })];

    renderWithNotificationHost(<EmailSuppressionsScreen />);

    expect(screen.getByText("Nightly digest")).toBeTruthy();
  });
});

/** `triggers:view` opens the page; removing a row reads `triggers:manage`. */
describe("when the reader may only view the triggers of this project", () => {
  it("shows the list and offers no way to resume delivery", () => {
    renderWithNotificationHost(
      <EmailSuppressionsScreen />,
      new FakeNotificationHost({ permissions: ["triggers:view"] }),
    );

    expect(screen.getByText("someone@example.com")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Actions for someone@example.com" })).toBeNull();
  });
});

describe("when the reader may manage the triggers of this project", () => {
  it("removes the row and says delivery resumed", async () => {
    const { host } = renderWithNotificationHost(<EmailSuppressionsScreen />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Actions for someone@example.com" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove suppression" }));

    expect(calls.remove).toHaveBeenCalledWith({ projectId: "project-1", id: "sup-1" });
    // The notice waits on the list being re-read, so that the reader is not
    // told delivery resumed while the row they removed is still on screen.
    await vi.waitFor(() => {
      expect(host.successes.at(-1)?.title).toBe("Suppression removed");
    });
  });
});

describe("given nobody has unsubscribed", () => {
  it("names where notifications are set up in this project", () => {
    state.rows = [];

    renderWithNotificationHost(<EmailSuppressionsScreen />);

    expect(screen.getByText("No suppressions yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open automations/ }).getAttribute("href")).toBe(
      "/web-app/automations",
    );
  });
});

describe("given the list could not be read", () => {
  it("says so and offers the read again rather than an empty table", () => {
    state.rows = [];
    state.isError = true;

    renderWithNotificationHost(<EmailSuppressionsScreen />);

    expect(screen.getByText(/could not load suppressions/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

describe("given more suppressions than one page holds", () => {
  it("reads the next page from Load more and ends without the button", async () => {
    state.nextCursor = { createdAt: new Date("2026-01-01T00:00:00.000Z"), id: "sup-1" };
    const { unmount } = renderWithNotificationHost(<EmailSuppressionsScreen />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Load more" }));
    expect(calls.fetchNextPage).toHaveBeenCalledTimes(1);

    unmount();
    state.nextCursor = null;
    renderWithNotificationHost(<EmailSuppressionsScreen />);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});
