import type * as HostDrawer from "@langwatch/browser-host/use-drawer";
/**
 * Leaving the "Add to Dataset" drawer hands the reader back to the drawer it was opened
 * from.
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const PATH = "/my-project/traces";
  const navigate = (url: string) => {
    window.history.replaceState({}, "", url);
    return Promise.resolve(true);
  };
  return {
    PATH,
    createRecord: vi.fn(),
    openHostDrawer: vi.fn(),
    rememberCreatedDataset: vi.fn(),
    router: {
      get query() {
        const query: Record<string, string> = {};
        new URLSearchParams(window.location.search).forEach((value, key) => {
          query[key] = value;
        });
        return query;
      },
      pathname: "/[project]/traces",
      get asPath() {
        return window.location.pathname + window.location.search;
      },
      push: navigate,
      replace: navigate,
    },
  };
});

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("../../../../__tests__/window-location-router.ts")).windowLocationRouter,
}));

vi.mock("@langwatch/browser-host/use-router", () => ({
  default: harness.router,
  useRouter: () => harness.router,
}));

vi.mock("../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "my-project" },
  }),
}));

vi.mock("../../../../behavior/use-local-storage-selected-dataset-id.ts", () => ({
  useLocalStorageSelectedDataSetId: () => ({
    selectedDataSetId: "dataset-1",
    setSelectedDataSetId: () => Promise.resolve(),
    rememberCreatedDataset: harness.rememberCreatedDataset,
  }),
}));

// The real navigator, with the hop to dataset's editor recorded rather than taken.
vi.mock("@langwatch/browser-host/use-drawer", async (importOriginal) => {
  const actual = await importOriginal<typeof HostDrawer>();
  return {
    ...actual,
    useDrawer: () => {
      const drawer = actual.useDrawer();
      return {
        ...drawer,
        openDrawer: (...args: Parameters<typeof drawer.openDrawer>) => {
          if (args[0] === "addOrEditDataset") harness.openHostDrawer(args[0], args[1]);
          else drawer.openDrawer(...args);
        },
      };
    },
  };
});

vi.mock("../../../../behavior/trace-api.ts", () => ({
  api: {
    useUtils: () => ({
      dataset: { getAll: { invalidate: vi.fn() } },
      datasetRecord: { getAll: { invalidate: vi.fn() } },
    }),
    traces: {
      getTracesWithSpans: {
        useQuery: () => ({ data: [{ trace_id: "trace-1" }] }),
      },
    },
  },
}));
vi.mock("@langwatch/dataset-client", () => ({
  datasetClient: {
    useUtils: () => ({
      dataset: { getAll: { invalidate: vi.fn() } },
      datasetRecord: { getAll: { invalidate: vi.fn() } },
    }),
    dataset: {
      getAll: {
        useQuery: () => ({
          data: [{ id: "dataset-1", name: "offline evals", columnTypes: [] }],
          isLoading: false,
          isError: false,
          refetch: () => Promise.resolve(),
        }),
      },
    },
    datasetRecord: {
      create: {
        useMutation: () => ({
          mutateAsync: harness.createRecord,
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("../dataset-selector.tsx", () => ({
  DatasetSelector: ({ onCreateNew }: { onCreateNew?: () => void }) => (
    <button type="button" onClick={onCreateNew}>
      New dataset
    </button>
  ),
}));

vi.mock("../dataset-mapping-preview.tsx", () => ({
  DatasetMappingPreview: ({
    onRowDataChange,
  }: {
    onRowDataChange: (rows: Record<string, unknown>[]) => void;
  }) => {
    useEffect(() => {
      onRowDataChange([{ selected: true, input: "hello" }]);
    }, [onRowDataChange]);
    return <div data-testid="mapping-preview" />;
  },
}));

vi.mock("@langwatch/design-system/toaster", () => ({
  toaster: { create: vi.fn() },
}));

import { useDrawer } from "@langwatch/browser-host/use-drawer";

import { useAnnotationQueueSessionStore } from "../../../../behavior/annotation-queue-session.store.ts";
import { AddDatasetRecordDrawer } from "../add-dataset-record-drawer.tsx";

/** Opens the trace drawer the way a trace row does, then the dataset drawer. */
function OpenFromTrace() {
  const { openDrawer, currentDrawer } = useDrawer();
  const opened = useRef<string[]>([]);
  useEffect(() => {
    // One step per render, since the navigator reads the address it rendered with.
    const next = opened.current.length === 0 ? "traceV2Details" : "addDatasetRecord";
    if (opened.current.length === 2 || (next === "addDatasetRecord" && !currentDrawer)) return;
    opened.current.push(next);
    openDrawer(
      next,
      next === "traceV2Details" ? { traceId: "trace-1", t: "1700000000" } : { traceId: "trace-1" },
    );
  }, [currentDrawer, openDrawer]);
  return null;
}

/** Opens the dataset drawer straight from a selection, with no trace behind. */
function OpenFromSelection() {
  const { openDrawer } = useDrawer();
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    openDrawer("addDatasetRecord", {
      selectedTraceIds: ["trace-1", "trace-2"],
    });
  }, [openDrawer]);
  return null;
}

function renderDrawer(Opener: () => null) {
  return renderWithDesignSystem(
    <>
      <Opener />
      <AddDatasetRecordDrawer traceId="trace-1" />
    </>,
  );
}

function drawerInUrl(): Record<string, string> {
  const drawer: Record<string, string> = {};
  new URLSearchParams(window.location.search).forEach((value, key) => {
    if (key.startsWith("drawer.")) drawer[key.replace("drawer.", "")] = value;
  });
  return drawer;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", harness.PATH);
  useAnnotationQueueSessionStore.setState({
    active: false,
    marks: {},
    handoff: "idle",
  });
  harness.createRecord.mockImplementation(
    async (_input: unknown, callbacks?: { onSuccess?: () => void; onError?: () => void }) => {
      callbacks?.onSuccess?.();
    },
  );
});

describe("given the dataset drawer was opened from a trace", () => {
  describe("when I close it", () => {
    /** @scenario "Closing Add to Dataset opened from a trace returns me to that trace" */
    it("puts that trace's drawer back", async () => {
      renderDrawer(OpenFromTrace);

      fireEvent.click(await screen.findByRole("button", { name: "Close" }));

      await waitFor(() => {
        expect(drawerInUrl()).toMatchObject({
          open: "traceV2Details",
          traceId: "trace-1",
        });
      });
    });
  });

  describe("when the records are added", () => {
    /** @scenario "Adding the records hands me back to the trace as well" */
    it("puts that trace's drawer back too", async () => {
      renderDrawer(OpenFromTrace);

      const submit = await screen.findByRole("button", {
        name: /to dataset/i,
      });
      await act(async () => {
        fireEvent.click(submit);
      });

      expect(harness.createRecord).toHaveBeenCalled();
      await waitFor(() => {
        expect(drawerInUrl()).toMatchObject({
          open: "traceV2Details",
          traceId: "trace-1",
        });
      });
    });
  });
});

describe("given the drawer is the end of an annotation queue walk", () => {
  const addTheRecords = async () => {
    const submit = await screen.findByRole("button", { name: /to dataset/i });
    await act(async () => {
      fireEvent.click(submit);
    });
  };

  describe("when the records are added", () => {
    /** @scenario "Completing or confirming without a dataset ends the session" */
    it("tells the sitting its traces landed", async () => {
      useAnnotationQueueSessionStore.setState({ active: true });
      renderDrawer(OpenFromSelection);

      await addTheRecords();

      expect(useAnnotationQueueSessionStore.getState().handoff).toBe("added");
    });
  });

  // The guard on the scenario above: a drawer opened outside a walk has no
  // sitting to finish, and announcing one would show a completion screen over
  // a queue nobody is working through.
  describe("when the records are added outside a queue walk", () => {
    it("says nothing to a sitting that is not happening", async () => {
      renderDrawer(OpenFromSelection);

      await addTheRecords();

      expect(useAnnotationQueueSessionStore.getState().handoff).toBe("idle");
    });
  });
});

describe("given the dataset drawer was opened from a selection in the list", () => {
  describe("when I close it", () => {
    /** @scenario "Closing Add to Dataset opened from the traces list closes it outright" */
    it("leaves no drawer open", async () => {
      renderDrawer(OpenFromSelection);

      fireEvent.click(await screen.findByRole("button", { name: "Close" }));

      await waitFor(() => {
        expect(drawerInUrl()).toEqual({});
      });
    });
  });
});

describe("given the reader wants a new dataset from the drawer", () => {
  describe("when they ask for one", () => {
    /** @scenario "Creating a dataset from Add to Dataset opens the dataset editor, then returns" */
    it("navigates to dataset's editor, coming back to this drawer when it closes", async () => {
      renderDrawer(OpenFromTrace);

      fireEvent.click(await screen.findByRole("button", { name: "New dataset" }));

      expect(harness.openHostDrawer).toHaveBeenCalledWith(
        "addOrEditDataset",
        expect.objectContaining({ onClose: expect.any(Function) }),
      );
    });

    /** @scenario "Creating a dataset from Add to Dataset opens the dataset editor, then returns" */
    it("remembers the dataset it saved, so the drawer returns with it chosen", async () => {
      renderDrawer(OpenFromTrace);

      fireEvent.click(await screen.findByRole("button", { name: "New dataset" }));
      const props: unknown = harness.openHostDrawer.mock.calls[0]?.[1];
      const onSuccess =
        props && typeof props === "object" && "onSuccess" in props ? props.onSuccess : undefined;
      if (typeof onSuccess === "function") {
        onSuccess({ datasetId: "dataset-new", name: "New", columnTypes: [] });
      }

      expect(harness.rememberCreatedDataset).toHaveBeenCalledWith("dataset-new");
    });
  });
});
