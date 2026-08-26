/** @vitest-environment jsdom */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DejaView, useDejaViewState } from "../src";

const events = [
  {
    eventId: "event-1",
    eventType: "SessionStarted",
    eventTimestamp: "1000",
    payload: { state: "started" },
  },
  {
    eventId: "event-2",
    eventType: "SessionCompleted",
    eventTimestamp: "2000",
    payload: { state: "completed" },
  },
];

type DejaViewProps = Parameters<typeof DejaView>[0];

afterEach(() => cleanup());

function createProps(overrides: Partial<DejaViewProps> = {}): DejaViewProps {
  return {
    searchQuery: "",
    tenantFilter: "",
    hasSearched: false,
    searchResults: void 0,
    searchLoading: false,
    searchLookbackDays: null,
    hotTierDays: null,
    hotTierEnvVar: null,
    selectedAggregate: null,
    events: [],
    eventsLoading: false,
    eventCursor: 0,
    selectedProjection: null,
    showEventDetail: false,
    showDiff: true,
    matchingProjections: [],
    matchingEventSubscribers: [],
    projectionState: void 0,
    previousProjectionState: void 0,
    projectionStateLoading: false,
    managers: [],
    managersLoading: false,
    managersError: null,
    renderKey: (label) => <kbd>{label}</kbd>,
    onSearchQueryChange: vi.fn(),
    onTenantFilterChange: vi.fn(),
    onSearch: vi.fn(),
    onSelectAggregate: vi.fn(),
    onBack: vi.fn(),
    onSelectProjection: vi.fn(),
    onToggleDiff: vi.fn(),
    onToggleEventDetail: vi.fn(),
    onSelectEvent: vi.fn(),
    ...overrides,
  };
}

function view(props: DejaViewProps) {
  return (
    <ChakraProvider value={defaultSystem}>
      <DejaView {...props} />
    </ChakraProvider>
  );
}

function renderDejaView(overrides: Partial<DejaViewProps> = {}) {
  const initialProps = createProps(overrides);
  const rendered = render(view(initialProps));

  return {
    ...rendered,
    rerenderDejaView(next: Partial<DejaViewProps>) {
      rendered.rerender(view(createProps({ ...overrides, ...next })));
    },
  };
}

describe("DejaView", () => {
  it("shows the guided state before the first search", () => {
    renderDejaView();

    expect(screen.getByText("Search for an aggregate ID to get started.")).toBeDefined();
  });

  it("shows the empty result state after a completed search", () => {
    renderDejaView({ hasSearched: true, searchResults: [] });

    expect(screen.getByText("No aggregates found")).toBeDefined();
    expect(screen.getByText(/No aggregates match your search criteria/)).toBeDefined();
  });

  it("forwards search field changes and keyboard submission", () => {
    const onSearchQueryChange = vi.fn();
    const onTenantFilterChange = vi.fn();
    const onSearch = vi.fn();

    renderDejaView({ onSearchQueryChange, onTenantFilterChange, onSearch });

    fireEvent.change(screen.getByPlaceholderText("Search aggregate ID..."), {
      target: { value: "aggregate-1" },
    });
    fireEvent.change(screen.getByPlaceholderText("Tenant ID (optional)"), {
      target: { value: "tenant-1" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("Search aggregate ID..."), {
      key: "Enter",
    });

    expect(onSearchQueryChange).toHaveBeenCalledWith("aggregate-1");
    expect(onTenantFilterChange).toHaveBeenCalledWith("tenant-1");
    expect(onSearch).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Search aggregates" })).toBeDefined();
  });

  it("keeps replay empty and error states explicit", () => {
    const selectedAggregate = { aggregateId: "aggregate-1", tenantId: "tenant-1" };
    const rendered = renderDejaView({ selectedAggregate });

    expect(screen.getByText("No events found for this aggregate.")).toBeDefined();

    rendered.rerenderDejaView({
      eventsError: <span>Event storage is unavailable</span>,
    });

    expect(screen.getByText("Event storage is unavailable")).toBeDefined();
  });

  it("forwards replay keyboard, timeline and projection actions", () => {
    const onSelectEvent = vi.fn();
    const onToggleEventDetail = vi.fn();
    const onSelectProjection = vi.fn();

    renderDejaView({
      selectedAggregate: { aggregateId: "aggregate-1", tenantId: "tenant-1" },
      events,
      matchingProjections: [
        {
          projectionName: "SessionProjection",
          pipelineName: "session-processing",
          aggregateType: "session",
        },
      ],
      onSelectEvent,
      onToggleEventDetail,
      onSelectProjection,
    });

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "e" });
    fireEvent.click(
      screen.getByRole("button", { name: "Select event 2: SessionCompleted" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /SessionProjection/ }));

    expect(onSelectEvent).toHaveBeenNthCalledWith(1, 1);
    expect(onSelectEvent).toHaveBeenNthCalledWith(2, 1);
    expect(onToggleEventDetail).toHaveBeenCalledOnce();
    expect(onSelectProjection).toHaveBeenCalledWith("SessionProjection");
  });

  it("renders projection diff and manager failure without collapsing replay", () => {
    const onToggleDiff = vi.fn();

    renderDejaView({
      selectedAggregate: { aggregateId: "aggregate-1", tenantId: "tenant-1" },
      events,
      selectedProjection: "SessionProjection",
      projectionState: { state: "completed" },
      previousProjectionState: { state: "started" },
      managersError: "Could not load process managers",
      onToggleDiff,
    });

    fireEvent.click(screen.getByRole("button", { name: "Diff on" }));

    expect(screen.getByText("SessionProjection")).toBeDefined();
    expect(screen.getByText("Could not load process managers")).toBeDefined();
    expect(onToggleDiff).toHaveBeenCalledOnce();
  });

  it("hydrates a deep-linked aggregate and keeps event navigation in the URL", () => {
    const url = "/ops/dejaview#a=aggregate-1&at=tenant-1&e=2";
    const replaceState = vi
      .spyOn(window.history, "replaceState")
      .mockImplementation(() => void 0);

    const { result } = renderHook(() => useDejaViewState(url));

    expect(result.current.selectedAggregate).toEqual({
      aggregateId: "aggregate-1",
      tenantId: "tenant-1",
    });
    expect(result.current.eventCursor).toBe(2);

    act(() => result.current.setEventCursor(3));

    expect(replaceState).toHaveBeenLastCalledWith(
      null,
      "",
      "/ops/dejaview#q=aggregate-1&t=tenant-1&a=aggregate-1&at=tenant-1&e=3",
    );
    replaceState.mockRestore();
  });
});
