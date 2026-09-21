/**
 * @vitest-environment jsdom
 *
 * The connection's event log: a read that says what happened, keeps a failed
 * read apart from an empty history, and never hides carried-over evidence.
 */

import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ActivityOptions = { onData?: (data: { connectionId: string }) => void };

const { state } = vi.hoisted(() => ({
  state: {
    entries: [] as Record<string, unknown>[],
    isLoading: false,
    isError: false,
    invalidate: vi.fn(),
    activity: void 0 as { input: unknown; options: ActivityOptions } | undefined,
  },
}));

vi.mock("../../../behavior/sso-api.ts", () => ({
  ssoApi: {
    useUtils: () => ({ ssoSetup: { getHistory: { invalidate: state.invalidate } } }),
    ssoSetup: {
      getHistory: {
        useQuery: () => ({
          data: state.isError ? undefined : state.entries,
          isLoading: state.isLoading,
          isError: state.isError,
        }),
      },
      onHistoryActivity: {
        useSubscription: (input: unknown, options: ActivityOptions) => {
          state.activity = { input, options };
        },
      },
    },
  },
}));

import { renderWithSsoHost } from "../../../testing.tsx";
import { HistorySection } from "../history.section.tsx";

const TARGET = { organizationId: "org-1", connectionId: "ssoc_1" };

const entry = (overrides: Record<string, unknown> = {}) => ({
  eventId: "evt_1",
  occurredAtMs: Date.UTC(2026, 0, 2, 9, 30, 0),
  summary: "Ana registered Okta as the identity provider.",
  carriedOver: false,
  ...overrides,
});

beforeEach(() => {
  state.entries = [];
  state.isLoading = false;
  state.isError = false;
  state.activity = void 0;
  state.invalidate.mockClear();
});

afterEach(cleanup);

describe("given the connection has a history", () => {
  /** @scenario "An administrator reads their own connection's history on the identity provider page" */
  it("says what happened, in the words the server composed", () => {
    state.entries = [entry()];

    renderWithSsoHost(<HistorySection {...TARGET} />);

    expect(screen.getByText("Ana registered Okta as the identity provider.")).toBeTruthy();
    expect(screen.getAllByTestId("connection-history-entry")).toHaveLength(1);
  });

  it("states each day once rather than on every line", () => {
    state.entries = [
      entry(),
      entry({ eventId: "evt_2", occurredAtMs: Date.UTC(2026, 0, 2, 11, 0, 0) }),
    ];

    renderWithSsoHost(<HistorySection {...TARGET} />);

    expect(screen.getAllByTestId("connection-history-entry")).toHaveLength(2);
    expect(screen.getAllByTestId("connection-history-day")).toHaveLength(1);
  });
});

describe("given a fact the migration carried over", () => {
  /** @scenario "A connection carried over from an earlier configuration says so" */
  it("names it, because weaker evidence must never become invisible", () => {
    state.entries = [entry({ carriedOver: true })];

    renderWithSsoHost(<HistorySection {...TARGET} />);

    expect(screen.getByText("Carried over")).toBeTruthy();
  });
});

describe("given nothing has happened yet", () => {
  it("says so", () => {
    renderWithSsoHost(<HistorySection {...TARGET} />);

    expect(screen.getByText(/nothing has happened to this connection yet/i)).toBeTruthy();
  });
});

describe("given something happens while the panel is open", () => {
  /** @scenario "The identity provider page refreshes its history when something changes" */
  it("re-reads the history it already had permission to see, and renders nothing of the signal", () => {
    state.entries = [entry()];

    const { container } = renderWithSsoHost(<HistorySection {...TARGET} />);
    const before = container.textContent;

    expect(state.activity?.input).toEqual(TARGET);

    act(() => {
      state.activity?.options.onData?.({ connectionId: TARGET.connectionId });
    });

    expect(state.invalidate).toHaveBeenCalledWith(TARGET);
    expect(container.textContent).toBe(before);
  });
});

describe("given the read failed", () => {
  it("says the history could not be read, not that there is none", () => {
    state.isError = true;

    renderWithSsoHost(<HistorySection {...TARGET} />);

    expect(screen.getByText(/could not be loaded/i)).toBeTruthy();
    expect(screen.queryByText(/nothing has happened/i)).toBeNull();
  });
});
