/**
 * @vitest-environment jsdom
 *
 * Settings → Email Suppressions: who is on the list, and who may take them off.
 *
 * TWO GRANTS, ONE PAGE, and that is the decision worth pinning. Opening the
 * page reads `triggers:view`; removing a row RESUMES DELIVERY to an address
 * that asked to stop hearing from us, so the button behind it reads the
 * narrower `triggers:manage`. A reader with only the first sees the list and no
 * way to act on it.
 *
 * The badge is the other one. A row with no trigger id is a recipient who opted
 * out of EVERYTHING this project sends, and saying so plainly is what stops an
 * operator removing it thinking they are unblocking one notification.
 *
 * Spec: specs/settings/settings-page-chrome.feature
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, calls } = vi.hoisted(() => ({
  state: {
    rows: [] as Array<Record<string, unknown>>,
    isLoading: false,
    isError: false,
  },
  calls: { remove: vi.fn(), invalidate: vi.fn().mockResolvedValue(void 0) },
}));

vi.mock("../../../behavior/notification-api", () => ({
  notificationApi: {
    useUtils: () => ({
      emailSuppression: { getAll: { invalidate: calls.invalidate } },
    }),
    emailSuppression: {
      getAll: {
        useQuery: () => ({
          data: state.rows,
          isLoading: state.isLoading,
          isError: state.isError,
          isRefetching: false,
          refetch: vi.fn(),
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

import { FakeNotificationHost, renderWithNotificationHost } from "../../../testing";
import EmailSuppressionsScreen from "../email-suppressions.screen";

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

describe("when the reader may only view the triggers of this project", () => {
  it("shows the list and offers no way to resume delivery", () => {
    renderWithNotificationHost(
      <EmailSuppressionsScreen />,
      new FakeNotificationHost({ permissions: ["triggers:view"] }),
    );

    expect(screen.getByText("someone@example.com")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove suppression" })).toBeNull();
  });
});

describe("when the reader may manage the triggers of this project", () => {
  it("removes the row and says delivery resumed", async () => {
    const { host } = renderWithNotificationHost(<EmailSuppressionsScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Remove suppression" }));

    expect(calls.remove).toHaveBeenCalledWith({ projectId: "project-1", id: "sup-1" });
    // The notice waits on the list being re-read, so that the reader is not
    // told delivery resumed while the row they removed is still on screen.
    await vi.waitFor(() => {
      expect(host.successes.at(-1)?.title).toBe("Suppression removed");
    });
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
