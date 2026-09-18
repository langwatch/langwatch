/**
 * @vitest-environment jsdom
 *
 * The connection's event log on the identity provider page: what an
 * administrator reads there, and what makes it re-read itself.
 *
 * Corresponds to specs/identity/sso-connection-history.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  entries: [] as unknown[],
  isLoading: false,
  isError: false,
  /** The options the component handed the subscription, so a test can be
   *  the server and push a signal at it. */
  subscribed: null as null | {
    input: { organizationId: string; connectionId: string };
    onData?: (data: unknown) => void;
  },
}));

const { invalidateHistory } = vi.hoisted(() => ({
  invalidateHistory: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    ssoSetup: {
      getHistory: {
        useQuery: () => ({
          data: state.entries,
          isLoading: state.isLoading,
          isError: state.isError,
          error: null,
        }),
      },
      onHistoryActivity: {},
    },
    useUtils: () => ({
      ssoSetup: { getHistory: { invalidate: invalidateHistory } },
    }),
  },
}));

vi.mock("~/hooks/useSSESubscription", () => ({
  useSSESubscription: (
    _subscription: unknown,
    input: { organizationId: string; connectionId: string },
    options: { onData?: (data: unknown) => void },
  ) => {
    state.subscribed = { input, onData: options.onData };
  },
}));

const { HistorySection } = await import("../HistorySection");

const ORGANIZATION = "org_acme";
const CONNECTION = "ssoc_acme";

const draw = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <HistorySection organizationId={ORGANIZATION} connectionId={CONNECTION} />
    </ChakraProvider>,
  );

/** Newest first, which is the order the read itself returns. */
const HISTORY = [
  {
    eventId: "evt_5",
    occurredAtMs: Date.parse("2026-09-16T17:53:42Z"),
    summary: "The connection was turned on",
    carriedOver: false,
  },
  {
    eventId: "evt_4",
    occurredAtMs: Date.parse("2026-09-16T13:01:07Z"),
    summary: "acme.com was verified using a DNS record",
    carriedOver: false,
  },
  {
    eventId: "evt_3",
    occurredAtMs: Date.parse("2026-09-15T12:59:21Z"),
    summary: "The connection was registered",
    carriedOver: false,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Fixed, because "Today" and "Yesterday" are read off the clock and the
  // grouping is what puts the date on a heading instead of on every row.
  vi.setSystemTime(new Date("2026-09-16T19:00:00Z"));
  state.entries = HISTORY;
  state.isLoading = false;
  state.isError = false;
  state.subscribed = null;
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("given an administrator on the identity provider page", () => {
  describe("when the history panel is on screen", () => {
    /** @scenario "An administrator reads their own connection's history on the identity provider page" */
    it("lists what happened, newest first, and offers no control that changes anything", () => {
      draw();

      const panel = screen.getByTestId("connection-history");
      const rendered = within(panel)
        .getAllByTestId("connection-history-entry")
        .map((row) => row.textContent ?? "");

      // Every fact is here, in the order the read returned them.
      expect(rendered).toHaveLength(3);
      expect(rendered[0]).toContain("The connection was turned on");
      expect(rendered[1]).toContain("acme.com was verified using a DNS record");
      expect(rendered[2]).toContain("The connection was registered");

      // A HISTORY A READER COULD EDIT WOULD NOT BE ONE. Nothing on the panel
      // is pressable or typeable — not a retry, not a filter, not a hidden
      // "clear". The assertion is over the whole panel rather than over a
      // list of controls we thought of, so a control added later fails here.
      expect(within(panel).queryAllByRole("button")).toHaveLength(0);
      expect(within(panel).queryAllByRole("textbox")).toHaveLength(0);
      expect(within(panel).queryAllByRole("checkbox")).toHaveLength(0);
    });

    it("states each day once rather than repeating the date on every row", () => {
      draw();

      const panel = screen.getByTestId("connection-history");
      // Two of the three happened on the reader's today, one the day before.
      expect(within(panel).getByText("Today")).toBeInTheDocument();
      expect(within(panel).getByText("Yesterday")).toBeInTheDocument();
    });
  });

  describe("when something changes while they are looking at it", () => {
    /** @scenario "The identity provider page refreshes its history when something changes" */
    it("re-reads the history it already had permission to see, and renders nothing about the signal", () => {
      draw();

      // The subscription is opened for this page's own connection, and for
      // nothing wider.
      expect(state.subscribed?.input).toEqual({
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
      });

      const before = screen.getByTestId("connection-history").textContent ?? "";

      // Be the server: yield the bare "something changed" signal.
      state.subscribed?.onData?.({ connectionId: CONNECTION });

      // It re-reads through the same guarded query — the refresh carries no
      // data of its own, so it discloses nothing the reader could not
      // already read.
      expect(invalidateHistory).toHaveBeenCalledWith({
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
      });

      // AND THE SIGNAL ITSELF IS NOT RENDERED ANYWHERE. It is an instruction
      // to re-read, not a fact about the connection, so it must never reach
      // the page as a row, a toast or a connection id on screen.
      const after = screen.getByTestId("connection-history").textContent ?? "";
      expect(after).toBe(before);
      expect(after).not.toContain(CONNECTION);
    });
  });
});
