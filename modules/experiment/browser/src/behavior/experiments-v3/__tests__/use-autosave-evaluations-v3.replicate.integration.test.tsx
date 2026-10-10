/**
 * The editor half of replicating an experiment, through the real autosave hook:
 * open a row (load path), edit, wait for the debounced save (save path), and check
 * which experiment id the save is addressed to.
 * @see specs/experiments-v3/experiment-replicate.feature
 * @vitest-environment jsdom
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEvaluationsV3Store } from "../use-evaluations-v3-store.ts";

const AUTOSAVE_DEBOUNCE_MS = 1500;

type Row = {
  id: string;
  slug: string;
  version: number;
  workbenchState: Record<string, unknown> | null;
};

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  rows: new Map<string, unknown>(),
  route: { slug: "" },
}));

vi.mock("../../experiment-api.ts", () => ({
  experimentApi: {
    useUtils: () => ({
      experiments: {
        getEvaluationsV3BySlug: { invalidate: vi.fn(), reset: vi.fn(), fetch: vi.fn() },
      },
    }),
    experiments: {
      saveEvaluationsV3: {
        useMutation: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
      },
      getEvaluationsV3BySlug: {
        useQuery: (
          input: { experimentSlug: string },
          options: { enabled?: boolean } | undefined,
        ) => ({
          data:
            options?.enabled === false ? undefined : (mocks.rows.get(input.experimentSlug) ?? null),
          isLoading: false,
        }),
      },
    },
  },
}));

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ query: { slug: mocks.route.slug }, push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1", slug: "project" } }),
}));
vi.mock("@langwatch/browser-host/toaster", () => ({ toaster: { create: vi.fn() } }));
vi.mock("../../../model/posthog-error-capture.ts", () => ({
  captureException: vi.fn(),
  toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useAutosaveEvaluationsV3 } from "../use-autosave-evaluations-v3.ts";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const Harness = () => {
  useAutosaveEvaluationsV3();
  return <div />;
};
// A fresh element each time: rerendering an identical element would bail out.
const tree = () => (
  <QueryClientProvider client={queryClient}>
    <Harness />
  </QueryClientProvider>
);

const dataset = (rows: number) => ({
  id: "ds-1",
  name: "Inline",
  type: "inline",
  columns: [{ id: "input", name: "input", type: "string" }],
  inline: {
    columns: [{ id: "input", name: "input", type: "string" }],
    records: { input: Array(rows).fill("x") },
  },
});
const baseState = (over: Record<string, unknown> = {}) => ({
  name: "Original",
  datasets: [dataset(2)],
  activeDatasetId: "ds-1",
  evaluators: [],
  targets: [],
  ...over,
});
/** A row the way the server returns it. A pre-fix copy still embeds the source's identity. */
const row = (id: string, slug: string, state: Record<string, unknown>, version = 1): Row => ({
  id,
  slug,
  version,
  workbenchState: state,
});

const settle = () => act(async () => void vi.advanceTimersByTime(50));
const wait = () => act(async () => void vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 100));
const open = async (slug: string) => {
  mocks.route.slug = slug;
  const view = renderWithDesignSystem(tree());
  await settle();
  return view;
};
const savedIds = () => mocks.mutateAsync.mock.calls.map(([arg]) => arg.experimentId);

describe("editing a replicated experiment through the autosave hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    queryClient.clear();
    mocks.rows.clear();
    mocks.mutateAsync.mockImplementation(async ({ experimentId }) => ({
      id: experimentId,
      slug: "ignored",
      name: "saved",
      version: 2,
    }));
    useEvaluationsV3Store.getState().reset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("given a copy saved by the fixed server (no identity in its state)", () => {
    /** @scenario "Opening a copy in the editor saves to the copy" */
    it("loads under the copy's id and saves every edit to the copy", async () => {
      mocks.rows.set(
        "orig-slug",
        row(
          "orig-id",
          "orig-slug",
          baseState({ experimentId: "orig-id", experimentSlug: "orig-slug" }),
        ),
      );
      mocks.rows.set(
        "copy-slug",
        row("copy-id", "copy-slug", baseState({ name: "Original (copy)" })),
      );
      await open("copy-slug");

      expect(useEvaluationsV3Store.getState().experimentId).toBe("copy-id");
      act(() => useEvaluationsV3Store.getState().setName("Renamed copy"));
      act(() =>
        useEvaluationsV3Store
          .getState()
          .setCellValue({ datasetId: "ds-1", row: 0, columnId: "input", value: "edited" }),
      );
      await wait();

      expect(mocks.mutateAsync).toHaveBeenCalled();
      expect(new Set(savedIds())).toEqual(new Set(["copy-id"]));
      const sent = mocks.mutateAsync.mock.calls.at(-1)![0];
      expect(sent.state.name).toBe("Renamed copy");
      expect(sent.state.experimentId).not.toBe("orig-id");
    });
  });

  describe("given a copy made before the fix, whose state embeds the original's id and slug", () => {
    /** @scenario "Opening a copy in the editor saves to the copy" */
    it("still saves to the copy's row", async () => {
      mocks.rows.set(
        "copy-slug",
        row(
          "copy-id",
          "copy-slug",
          baseState({ name: "Old copy", experimentId: "orig-id", experimentSlug: "orig-slug" }),
        ),
      );
      await open("copy-slug");

      const loaded = useEvaluationsV3Store.getState();
      expect(loaded.experimentId).toBe("copy-id");
      expect(loaded.experimentSlug).toBe("copy-slug");

      act(() => useEvaluationsV3Store.getState().setName("Edited old copy"));
      await wait();

      expect(mocks.mutateAsync).toHaveBeenCalled();
      expect(savedIds()).not.toContain("orig-id");
      expect(new Set(savedIds())).toEqual(new Set(["copy-id"]));
    });
  });

  describe("given a copy of a copy and two copies of one original", () => {
    /** @scenario "Opening a copy in the editor saves to the copy" */
    it.each([
      ["copy of a copy", { experimentId: "copy1-id", experimentSlug: "copy1-slug" }],
      ["second sibling copy", { experimentId: "orig-id", experimentSlug: "orig-slug" }],
    ])("%s saves to its own row", async (_label, embedded) => {
      mocks.rows.set(
        "copy2-slug",
        row("copy2-id", "copy2-slug", baseState({ name: "C2", ...embedded })),
      );
      await open("copy2-slug");
      act(() => useEvaluationsV3Store.getState().setName("C2 edited"));
      await wait();
      expect(new Set(savedIds())).toEqual(new Set(["copy2-id"]));
    });
  });

  describe("given the editor switches from the original to a copy without a reload", () => {
    /** @scenario "Opening a copy in the editor saves to the copy" */
    it("saves the copy's content under the copy's id, never the original's", async () => {
      mocks.rows.set(
        "orig-slug",
        row("orig-id", "orig-slug", baseState({ name: "Original", datasets: [dataset(5)] })),
      );
      mocks.rows.set(
        "copy-slug",
        row(
          "copy-id",
          "copy-slug",
          baseState({
            name: "Original (copy)",
            datasets: [dataset(1)],
            experimentId: "orig-id",
            experimentSlug: "orig-slug",
          }),
        ),
      );
      const view = await open("orig-slug");
      expect(useEvaluationsV3Store.getState().experimentId).toBe("orig-id");

      // Navigate within the same mounted page: the store is NOT reset.
      mocks.route.slug = "copy-slug";
      view.rerender(tree());
      await settle();
      expect(useEvaluationsV3Store.getState().experimentId).toBe("copy-id");
      expect(useEvaluationsV3Store.getState().experimentSlug).toBe("copy-slug");

      act(() => useEvaluationsV3Store.getState().setName("Copy edited"));
      await wait();

      expect(mocks.mutateAsync).toHaveBeenCalled();
      expect(new Set(savedIds())).toEqual(new Set(["copy-id"]));
      const sent = mocks.mutateAsync.mock.calls.at(-1)![0];
      expect(sent.state.datasets[0].inline.records.input).toHaveLength(1);
    });

    /** @scenario "Opening another experiment starts from a clean editor" */
    it("does not carry the original's run results into the copy's save", async () => {
      mocks.rows.set("orig-slug", row("orig-id", "orig-slug", baseState()));
      mocks.rows.set(
        "copy-slug",
        row("copy-id", "copy-slug", baseState({ name: "Original (copy)" })),
      );
      const view = await open("orig-slug");
      act(() =>
        useEvaluationsV3Store.setState({
          results: {
            runId: "orig-run",
            status: "success",
            targetOutputs: {},
            targetMetadata: {},
            evaluatorResults: {},
            errors: {},
          } as never,
        }),
      );

      mocks.route.slug = "copy-slug";
      view.rerender(tree());
      await settle();
      expect(useEvaluationsV3Store.getState().experimentId).toBe("copy-id");
      expect(useEvaluationsV3Store.getState().results.runId).toBeUndefined();
      act(() => useEvaluationsV3Store.getState().setName("Copy edited"));
      await wait();

      const sent = mocks.mutateAsync.mock.calls.at(-1)![0];
      expect(JSON.stringify(sent.state)).not.toContain("orig-run");
    });

    /** @scenario "Opening an experiment with no saved state does not keep the previous one's content" */
    it("shows an empty editor for a row without saved state, and does not save the original's content into it", async () => {
      mocks.rows.set(
        "orig-slug",
        row("orig-id", "orig-slug", baseState({ name: "Original", datasets: [dataset(5)] })),
      );
      mocks.rows.set("bare-slug", {
        id: "bare-id",
        slug: "bare-slug",
        version: 1,
        workbenchState: null,
      });
      const view = await open("orig-slug");
      expect(useEvaluationsV3Store.getState().name).toBe("Original");

      mocks.route.slug = "bare-slug";
      view.rerender(tree());
      await settle();

      const loaded = useEvaluationsV3Store.getState();
      expect(loaded.experimentId).toBe("bare-id");
      expect(loaded.name).not.toBe("Original");
      expect(JSON.stringify(loaded.datasets)).not.toContain('"x","x","x","x","x"');
      await wait();
      expect(savedIds()).not.toContain("orig-id");
      expect(
        mocks.mutateAsync.mock.calls.every(
          ([arg]) => !JSON.stringify(arg.state).includes("Original"),
        ),
      ).toBe(true);
    });
  });
});
