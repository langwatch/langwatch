/**
 * @vitest-environment jsdom
 *
 * Every way of leaving a trace mid-correction asks the same question, in the
 * same dialog: closing the drawer, opening another trace, walking back through
 * the drawer's own history, and the browser's back button.
 * See specs/traces-v2/trace-edit-mode.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  currentDrawer: "traceV2Details" as string | undefined,
  drawerParams: {} as Record<string, string | undefined>,
  openDrawer: vi.fn(),
  closeDrawer: vi.fn(),
  fetchOverlay: vi.fn(),
  invalidateOverlay: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("../../../../../behavior/use-drawer", () => ({
  useDrawer: () => ({
    currentDrawer: mocks.currentDrawer,
    openDrawer: mocks.openDrawer,
    closeDrawer: mocks.closeDrawer,
  }),
  useDrawerParams: () => mocks.drawerParams,
}));

vi.mock("../../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));

vi.mock("../../../trace-api", () => ({
  api: {
    useUtils: () => ({
      traceEditOverlay: {
        getByTraceId: {
          invalidate: mocks.invalidateOverlay,
          fetch: mocks.fetchOverlay,
        },
      },
    }),
    traceEditOverlay: {
      upsert: {
        useMutation: () => ({ mutate: mocks.upsert, isLoading: false }),
      },
    },
  },
}));

vi.mock("../../../../blocks/toaster", () => ({ toaster: { create: vi.fn() } }));
vi.mock("../../../errors", () => ({ showErrorToast: vi.fn() }));

const { EditModeBar } = await import("../../trace-drawer/edit-mode/edit-mode-bar");
const { useDrawerStore } = await import("../../../../../index");
const { useTraceEditStore } = await import("../../../../../index");
const { guardTraceEditExit } = await import("../../utils/trace-edit-mode");
const { useTraceDrawerNavigation } = await import("../use-trace-drawer-navigation");
const { useTraceDrawerUrlHydrator } = await import("../use-trace-drawer-url-hydrator");

const TRACE = "trace-1";
const EARLIER_TRACE = "trace-0";

let navigation: ReturnType<typeof useTraceDrawerNavigation>;

function Harness() {
  navigation = useTraceDrawerNavigation();
  return <EditModeBar traceId={TRACE} />;
}

/** The page mounts the URL hydrator above the drawer; only the browser-history
 *  cases care about it, so it is a harness of its own. */
function HydratedHarness() {
  useTraceDrawerUrlHydrator();
  return <Harness />;
}

function harnessTree({ hydrate }: { hydrate: boolean }) {
  return (
    <ChakraProvider value={defaultSystem}>
      {hydrate ? <HydratedHarness /> : <Harness />}
    </ChakraProvider>
  );
}

function renderHarness({ hydrate = false }: { hydrate?: boolean } = {}) {
  const utils = render(harnessTree({ hydrate }));
  return {
    ...utils,
    /** Re-renders under the URL the browser has just navigated to. */
    followUrl: () => utils.rerender(harnessTree({ hydrate })),
  };
}

/** The browser leaving the drawer behind: no drawer in the URL any more. */
function browserLeavesTheDrawer(followUrl: () => void) {
  act(() => {
    mocks.currentDrawer = undefined;
    mocks.drawerParams = {};
    followUrl();
  });
}

const discardDialog = () => screen.queryByText("Discard trace corrections?");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentDrawer = "traceV2Details";
  mocks.drawerParams = { traceId: TRACE, edit: "1" };
  useTraceEditStore.getState().discard();
  useDrawerStore.getState().openTrace(TRACE, null);
  useDrawerStore.getState().setIsEditing(true);
  useTraceEditStore.getState().startEditing({ traceId: TRACE });
  useTraceEditStore.getState().setSpanName({
    spanId: "span-1",
    name: "search the web",
    baselineName: "handler",
  });
});

afterEach(cleanup);

describe("given a correction with unsaved changes", () => {
  describe("when the drawer is closed", () => {
    /** @scenario "Closing the drawer with unsaved changes asks first" */
    it("asks before the drawer goes", async () => {
      const close = vi.fn();
      renderHarness();

      act(() => {
        guardTraceEditExit(close);
      });

      expect(await screen.findByText("Discard trace corrections?")).toBeVisible();
      expect(close).not.toHaveBeenCalled();
    });

    /** @scenario "Closing the drawer with unsaved changes asks first" */
    it("closes it once the reviewer discards", async () => {
      const close = vi.fn();
      renderHarness();
      act(() => {
        guardTraceEditExit(close);
      });

      fireEvent.click(await screen.findByRole("button", { name: "Discard corrections" }));

      expect(close).toHaveBeenCalledTimes(1);
      expect(useTraceEditStore.getState().spanDrafts).toEqual({});
    });
  });

  describe("when another trace is opened from inside the drawer", () => {
    /** @scenario "Navigating to another trace with unsaved changes asks first" */
    it("asks before leaving the trace", async () => {
      renderHarness();

      act(() => {
        navigation.navigateToTrace({
          fromTraceId: TRACE,
          fromViewMode: "trace",
          toTraceId: "trace-2",
        });
      });

      expect(await screen.findByText("Discard trace corrections?")).toBeVisible();
      expect(mocks.openDrawer).not.toHaveBeenCalled();
      expect(useDrawerStore.getState().traceId).toBe(TRACE);
    });
  });

  describe("when the reviewer walks back through the drawer's history", () => {
    beforeEach(() => {
      useDrawerStore
        .getState()
        .pushTraceHistory({ traceId: EARLIER_TRACE, viewMode: "trace" });
    });

    /** @scenario "Going back to an earlier trace with unsaved changes asks first" */
    it("asks before going back, and keeps the trace open", async () => {
      renderHarness();

      act(() => navigation.goBack());

      expect(await screen.findByText("Discard trace corrections?")).toBeVisible();
      expect(mocks.openDrawer).not.toHaveBeenCalled();
      expect(useDrawerStore.getState().traceId).toBe(TRACE);
      // The history entry is still there for the reviewer to come back to.
      expect(useDrawerStore.getState().traceBackStack).toHaveLength(1);
    });

    /** @scenario "Going back to an earlier trace with unsaved changes asks first" */
    it("goes back once the reviewer discards", async () => {
      renderHarness();
      act(() => navigation.goBack());

      fireEvent.click(await screen.findByRole("button", { name: "Discard corrections" }));

      expect(mocks.openDrawer).toHaveBeenCalledWith(
        "traceV2Details",
        expect.objectContaining({ traceId: EARLIER_TRACE }),
      );
    });

    /** @scenario "Going back to an earlier trace with unsaved changes asks first" */
    it("asks the same way when a breadcrumb picks the trace", async () => {
      renderHarness();

      act(() => navigation.goBackTo(0));

      expect(await screen.findByText("Discard trace corrections?")).toBeVisible();
      expect(mocks.openDrawer).not.toHaveBeenCalled();
      expect(useDrawerStore.getState().traceBackStack).toHaveLength(1);
    });
  });

  describe("when browser history moves off the drawer", () => {
    /** @scenario "Browser back with unsaved changes keeps the correction" */
    it("keeps the correction and asks what to do with it", async () => {
      const { followUrl } = renderHarness({ hydrate: true });

      browserLeavesTheDrawer(followUrl);

      expect(useTraceEditStore.getState().editingTraceId).toBe(TRACE);
      expect(useTraceEditStore.getState().spanDrafts["span-1"]?.name).toBe(
        "search the web",
      );
      expect(useDrawerStore.getState().traceId).toBe(TRACE);
      expect(await screen.findByText("Discard trace corrections?")).toBeVisible();
    });

    /** @scenario "Browser back with unsaved changes keeps the correction" */
    it("puts the drawer's link back so the question has somewhere to live", () => {
      const { followUrl } = renderHarness({ hydrate: true });

      browserLeavesTheDrawer(followUrl);

      expect(mocks.openDrawer).toHaveBeenCalledWith("traceV2Details", {
        traceId: TRACE,
        urlParams: { edit: "1" },
      });
    });

    /** @scenario "Browser back with unsaved changes keeps the correction" */
    it("closes the drawer once the reviewer discards", async () => {
      const { followUrl } = renderHarness({ hydrate: true });
      browserLeavesTheDrawer(followUrl);

      fireEvent.click(await screen.findByRole("button", { name: "Discard corrections" }));

      expect(useDrawerStore.getState().traceId).toBeNull();
      expect(useTraceEditStore.getState().editingTraceId).toBeNull();
      // The link the hydrator put back comes out again with the correction.
      expect(mocks.closeDrawer).toHaveBeenCalled();
    });
  });
});

describe("given a correction with nothing changed yet", () => {
  beforeEach(() => {
    useTraceEditStore.getState().setSpanName({
      spanId: "span-1",
      name: "handler",
      baselineName: "handler",
    });
  });

  describe("when browser history moves off the drawer", () => {
    /** @scenario "Cancelling without changes leaves edit mode straight away" */
    it("closes the drawer without asking", () => {
      const { followUrl } = renderHarness({ hydrate: true });

      browserLeavesTheDrawer(followUrl);

      expect(discardDialog()).not.toBeInTheDocument();
      expect(useDrawerStore.getState().traceId).toBeNull();
      expect(useTraceEditStore.getState().editingTraceId).toBeNull();
    });
  });
});
