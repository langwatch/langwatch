/**
 * @vitest-environment jsdom
 *
 * Leaving the "Add to Dataset" drawer hands the reader back to the drawer it
 * was opened from. The real drawer component and the real drawer stack are
 * exercised; the router is a faithful harness that lands every navigation in
 * the address bar, and the dataset queries are stubbed so the drawer can reach
 * its submit.
 * See specs/traces-v2/drawer-stacking.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
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

vi.mock("../../../../behavior/next-router", () => ({
  default: harness.router,
  useRouter: () => harness.router,
}));

vi.mock("../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "my-project" },
  }),
}));

vi.mock("../../../../behavior/use-local-storage-selected-dataset-id", () => ({
  useLocalStorageSelectedDataSetId: () => ({
    selectedDataSetId: "dataset-1",
    setSelectedDataSetId: () => Promise.resolve(),
  }),
}));

vi.mock("../../trace-api", () => ({
  api: {
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
    traces: {
      getTracesWithSpans: {
        useQuery: () => ({ data: [{ trace_id: "trace-1" }] }),
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

vi.mock("../dataset-selector", () => ({
  DatasetSelector: () => <div data-testid="dataset-selector" />,
}));

vi.mock("../dataset-mapping-preview", () => ({
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

import { useAnnotationQueueSessionStore } from "../../../../behavior/annotation-queue-session.store";
import { clearDrawerStack, useDrawer } from "../../../../behavior/use-drawer";
import { AddDatasetRecordDrawer } from "../add-dataset-record-drawer";

/** Opens the trace drawer the way a trace row does, then the dataset drawer. */
function OpenFromTrace() {
  const { openDrawer } = useDrawer();
  useEffect(() => {
    openDrawer("traceV2Details", { traceId: "trace-1", t: "1700000000" });
    openDrawer("addDatasetRecord", { traceId: "trace-1" });
    // Opening is a one-shot setup, not a reaction to anything that changes.
  }, []);
  return null;
}

/** Opens the dataset drawer straight from a selection, with no trace behind. */
function OpenFromSelection() {
  const { openDrawer } = useDrawer();
  useEffect(() => {
    openDrawer("addDatasetRecord", {
      selectedTraceIds: ["trace-1", "trace-2"],
    });
  }, []);
  return null;
}

function renderDrawer(Opener: () => null) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Opener />
      <AddDatasetRecordDrawer traceId="trace-1" />
    </ChakraProvider>,
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
  clearDrawerStack();
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
