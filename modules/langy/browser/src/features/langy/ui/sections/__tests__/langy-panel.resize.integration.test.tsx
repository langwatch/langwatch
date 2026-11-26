/**
 * The panel's free edge is a drag handle: mouse, keyboard and double-click set its width,
 * and a drag is saved once, when it ends.
 * @vitest-environment jsdom
 * Spec: specs/langy/langy-panel-layout.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { act, cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "project-demo";

// The auto-resizing textarea (Ark's field-textarea) reaches for
// ResizeObserver on mount, which jsdom does not implement.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    sendMessage: vi.fn(),
    stop: vi.fn(),
    status: "ready",
    setMessages: vi.fn(),
    error: undefined,
    clearError: vi.fn(),
    regenerate: vi.fn(),
  }),
}));

/** The wrapper releases the dock reservation while a drawer is open — see
 * `ProjectLangyLayout`. Here the panel reads `currentDrawer` directly to know
 * it is riding beside one as a floating companion. */
const currentDrawerRef = { current: undefined as string | undefined };
vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({
    currentDrawer: currentDrawerRef.current,
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    goBack: vi.fn(),
  }),
}));

// Cuts the model picker's dependency chain onto the (unrelated) workflow
// studio host — this test is about the header's controls, not the picker.
vi.mock("../../elements/langy-model-pill.tsx", () => ({
  LangyModelPill: () => <div data-testid="model-pill" />,
}));

vi.mock("../../../../../behavior/langy-api.ts", async () => {
  const { createTrpcUtils, idleQuery, withFallback } =
    await import("../../../__tests__/support/langy-api-mock.ts");

  const trpcUtils = createTrpcUtils();

  const explicitApi: Record<string, unknown> = {
    langy: withFallback({
      list: {
        useInfiniteQuery: () => ({
          ...idleQuery(),
          data: { pages: [{ items: [], nextCursor: null }] },
          fetchNextPage: () => Promise.resolve(),
          hasNextPage: false,
          isFetchingNextPage: false,
        }),
      },
      modelsAllowed: {
        useQuery: () => ({
          data: { modelsAllowed: null },
          isLoading: false,
          isError: false,
        }),
      },
      messages: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          isFetching: false,
          isError: false,
        }),
      },
      stopTurn: { useMutation: () => ({ mutateAsync: () => Promise.resolve() }) },
      onConversationUpdate: { useSubscription: () => undefined },
    }),
    useUtils: () => trpcUtils,
    useContext: () => trpcUtils,
    modelProvider: {
      // A resolved model — the scenario is about the header, not the inline
      // model-setup branch, so the panel must not fall into it.
      getResolvedDefault: {
        useQuery: () => ({
          data: { model: "openai/gpt-5-mini" },
          isLoading: false,
          isSuccess: true,
          isError: false,
          refetch: () => Promise.resolve(),
        }),
      },
      listAllForProjectForFrontend: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      setRoleAssignmentForScope: { useMutation: () => ({ mutateAsync: () => Promise.resolve() }) },
      setFeatureOverrideForScope: { useMutation: () => ({ mutateAsync: () => Promise.resolve() }) },
    },
    virtualKeys: {
      list: { useQuery: () => ({ data: undefined, isLoading: false }) },
    },
    github: {
      getConnectionStatus: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: true }),
      },
      disconnect: { useMutation: () => ({ mutate: () => undefined, isPending: false }) },
    },
  };

  return { api: withFallback(explicitApi) };
});

import { useLangyStore } from "../../../../../behavior/langy.store.ts";
import {
  LangyHostApi,
  LangyHostProvider,
  type LangyRouteReading,
} from "../../../../../model/langy-host.ts";
import { LangyProvider } from "../../../../tools/ui/sections/langy-page-context.tsx";
import { useLangyDockWidthPx } from "../../../behavior/panel/use-langy-panel-layout.ts";
import { LangySidecar } from "../langy-panel.tsx";

vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

class FakeLangyHost extends LangyHostApi {
  project() {
    return { id: PROJECT_ID, slug: "demo", name: "demo" };
  }
  organization() {
    return { id: "org-1" };
  }
  team() {
    return { id: "team-1", isPersonal: false, members: [{ userId: "user-1" }] };
  }
  organizationRole() {
    return "MEMBER";
  }
  currentUser() {
    return { id: "user-1", email: "staff@langwatch.ai" };
  }
  hasOrganizationPermission() {
    return false;
  }
  hasPermission() {
    return true;
  }
  isLoading() {
    return false;
  }
  isDemoProject() {
    return false;
  }
  route(): LangyRouteReading {
    return { params: {}, query: {}, pathname: "/demo/traces" };
  }
  setQuery() {}
  navigate() {}
  planManagementUrl() {
    return undefined;
  }
  succeeded() {}
  failed() {}
}

const Wrapper = ({ children }: { children: ReactNode }) => (
  <DesignSystemProvider forcedTheme="light">
    <LangyHostProvider value={new FakeLangyHost()}>
      <LangyProvider>{children}</LangyProvider>
    </LangyHostProvider>
  </DesignSystemProvider>
);

/** The room the page reserves beside the dock; the layout reads the same hook for its padding. */
function DockRoomProbe() {
  return <output data-testid="dock-room">{useLangyDockWidthPx()}</output>;
}

function renderPanel() {
  return render(
    <>
      <LangySidecar />
      <DockRoomProbe />
    </>,
    { wrapper: Wrapper },
  );
}

/** How many times the stored widths changed while `act` ran. */
function storeWrites(act: () => void): number {
  let writes = 0;
  const unsubscribe = useLangyStore.subscribe((state, previous) => {
    if (state.panelWidths !== previous.panelWidths) writes++;
  });
  act();
  unsubscribe();
  return writes;
}

const HANDLE = { name: "Resize Langy panel" };

/** jsdom has no PointerEvent, so the generic event is given the fields the handle reads. */
function pointer(type: "pointerDown" | "pointerMove" | "pointerUp", element: Element, x: number) {
  const event = createEvent[type](element, {});
  Object.defineProperties(event, {
    clientX: { value: x },
    button: { value: 0 },
    pointerId: { value: 1 },
  });
  fireEvent(element, event);
}

const widthOf = (handle: HTMLElement) => Number(handle.getAttribute("aria-valuenow"));

beforeEach(() => {
  currentDrawerRef.current = undefined;
  window.innerWidth = 1_024;
  useLangyStore.setState({ isOpen: true, panelMode: "floating", panelWidths: {} });
});

afterEach(() => {
  cleanup();
});

describe("given the floating Langy panel is open", () => {
  /** @scenario "Dragging the free edge resizes the panel" */
  it("grows by the distance the handle is dragged toward the page, saved once on release", async () => {
    renderPanel();
    const handle = await screen.findByRole("separator", HANDLE);
    expect(widthOf(handle)).toBe(432);

    const writes = storeWrites(() => {
      pointer("pointerDown", handle, 600);
      pointer("pointerMove", handle, 550);
      pointer("pointerMove", handle, 500);
      expect(widthOf(handle)).toBe(532);
      expect(useLangyStore.getState().panelWidths).toEqual({});
      pointer("pointerUp", handle, 500);
    });

    expect(writes).toBe(1);
    expect(widthOf(handle)).toBe(532);
    expect(useLangyStore.getState().panelWidths).toEqual({ floating: 532 });
  });

  /** @scenario "Dragging the free edge resizes the panel" */
  it("abandons a drag when the layout changes under it, saving nothing to either layout", async () => {
    renderPanel();
    const handle = await screen.findByRole("separator", HANDLE);

    pointer("pointerDown", handle, 600);
    pointer("pointerMove", handle, 500);
    act(() => useLangyStore.setState({ panelMode: "sidebar" }));
    pointer("pointerMove", screen.getByRole("separator", HANDLE), 450);
    pointer("pointerUp", screen.getByRole("separator", HANDLE), 450);

    expect(useLangyStore.getState().panelWidths).toEqual({});
  });

  /** @scenario "Dragging the free edge resizes the panel" */
  /** @scenario "A floating card that dodged to the left corner is dragged from its right edge" */
  it("grows toward the right when the card has dodged to the left corner", async () => {
    currentDrawerRef.current = "traceV2Details";
    renderPanel();
    const handle = await screen.findByRole("separator", HANDLE);

    pointer("pointerDown", handle, 100);
    pointer("pointerMove", handle, 160);
    pointer("pointerUp", handle, 160);

    expect(widthOf(handle)).toBe(492);
    expect(useLangyStore.getState().panelWidths).toEqual({ floating: 492 });
  });

  /** @scenario "The width stays within a usable range" */
  it("stops at the viewport-derived maximum and the composer-safe minimum", async () => {
    renderPanel();
    const handle = await screen.findByRole("separator", HANDLE);

    pointer("pointerDown", handle, 600);
    pointer("pointerMove", handle, -2_000);
    expect(widthOf(handle)).toBe(Number(handle.getAttribute("aria-valuemax")));

    pointer("pointerMove", handle, 5_000);
    expect(widthOf(handle)).toBe(Number(handle.getAttribute("aria-valuemin")));
  });

  /** @scenario "The handle resizes from the keyboard" */
  it("steps with the arrow keys, saving each step", async () => {
    renderPanel();
    const handle = await screen.findByRole("separator", HANDLE);
    expect(handle).toHaveAttribute("aria-orientation", "vertical");

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(widthOf(handle)).toBe(448);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(widthOf(handle)).toBe(464);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(widthOf(handle)).toBe(448);
    expect(useLangyStore.getState().panelWidths).toEqual({ floating: 448 });
  });

  /** @scenario "Double-clicking the handle restores the default width" */
  it("returns to the default width on double-click and forgets the choice", async () => {
    renderPanel();
    const handle = await screen.findByRole("separator", HANDLE);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(widthOf(handle)).toBe(448);

    fireEvent.doubleClick(handle);

    expect(widthOf(handle)).toBe(432);
    expect(useLangyStore.getState().panelWidths).toEqual({});
  });

  /** @scenario "Double-clicking the handle restores the default width" */
  it("still resets and steps by keyboard after a click on the handle that moved nothing", async () => {
    renderPanel();
    const handle = await screen.findByRole("separator", HANDLE);

    pointer("pointerDown", handle, 600);
    pointer("pointerUp", handle, 600);
    fireEvent.doubleClick(handle);
    expect(widthOf(handle)).toBe(432);

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(widthOf(handle)).toBe(448);
  });

  /** @scenario "Each layout remembers its own width across reloads" */
  it("opens at the width stored for the floating card", async () => {
    useLangyStore.setState({ panelWidths: { floating: 500, sidebar: 450 } });
    renderPanel();

    expect(widthOf(await screen.findByRole("separator", HANDLE))).toBe(500);
  });
});

describe("given the docked Langy panel is open", () => {
  /** @scenario "Dragging the free edge resizes the panel" */
  it("drags from the dock's own default width and the page reservation follows on release", async () => {
    useLangyStore.setState({ panelMode: "sidebar" });
    renderPanel();
    const handle = await screen.findByRole("separator", HANDLE);
    expect(widthOf(handle)).toBe(392);
    expect(screen.getByTestId("dock-room")).toHaveTextContent("392");

    const writes = storeWrites(() => {
      pointer("pointerDown", handle, 600);
      pointer("pointerMove", handle, 540);
      pointer("pointerUp", handle, 540);
    });

    expect(writes).toBe(1);
    expect(widthOf(handle)).toBe(452);
    expect(useLangyStore.getState().panelWidths).toEqual({ sidebar: 452 });
    expect(screen.getByTestId("dock-room")).toHaveTextContent("452");
  });
});

describe("given the panel has no free edge to drag", () => {
  /** @scenario "The handle is absent while the panel is minimised or beside a drawer" */
  it("shows no handle while minimised", async () => {
    useLangyStore.setState({ isOpen: false });
    renderPanel();

    expect(screen.queryByRole("separator", HANDLE)).not.toBeInTheDocument();
  });

  /** @scenario "The handle is absent while the panel is minimised or beside a drawer" */
  it("shows no handle while riding beside a drawer", async () => {
    useLangyStore.setState({ panelMode: "sidebar" });
    currentDrawerRef.current = "traceV2Details";
    renderPanel();

    expect(await screen.findByRole("button", { name: "New chat" })).toBeInTheDocument();
    expect(screen.queryByRole("separator", HANDLE)).not.toBeInTheDocument();
  });
});
