/**
 * @vitest-environment jsdom
 *
 * The reconciliation rule for a workbench someone else wrote to
 * (specs/langy/langy-ui-actions-fallback.feature): a clean workbench reloads
 * silently, a dirty one banners and waits for the user, and a stale signal for
 * some other experiment changes nothing.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sseCalls: Array<{
  input: unknown;
  options: { enabled: boolean; onData: (data: unknown) => void };
}> = [];

vi.mock("~/hooks/useSSESubscription", () => ({
  useSSESubscription: (
    _route: unknown,
    input: unknown,
    options: { enabled: boolean; onData: (data: unknown) => void },
  ) => {
    sseCalls.push({ input, options });
    return { connectionState: "open" };
  },
}));

const fetchVersion = vi.fn();
vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      experiments: { getWorkbenchVersion: { fetch: fetchVersion } },
    }),
    experiments: { onExperimentUpdate: {} },
  },
}));

import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { useWorkbenchUpdateListener } from "../hooks/useWorkbenchUpdateListener";

function emitSignal(version: number, slug = "my-exp") {
  const call = sseCalls.at(-1)!;
  act(() => {
    call.options.onData({
      event: JSON.stringify({
        event: "experiment_updated",
        experimentId: "experiment_1",
        slug,
        version,
        actorLabel: "langy",
      }),
      timestamp: Date.now(),
    });
  });
}

describe("useWorkbenchUpdateListener", () => {
  beforeEach(() => {
    sseCalls.length = 0;
    fetchVersion.mockReset();
    useEvaluationsV3Store.getState().reset();
    useEvaluationsV3Store.getState().setWorkbenchVersion(4);
  });

  afterEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  describe("when a newer version lands and the workbench is clean", () => {
    /** @scenario A backend edit refreshes an idle workbench automatically */
    it("reloads silently and never banners", async () => {
      const reloadFromServer = vi.fn(async () => undefined);
      renderHook(() =>
        useWorkbenchUpdateListener({
          projectId: "project-1",
          experimentSlug: "my-exp",
          isDirty: false,
          reloadFromServer,
        }),
      );

      emitSignal(5);

      await waitFor(() => expect(reloadFromServer).toHaveBeenCalledTimes(1));
      expect(useEvaluationsV3Store.getState().staleWorkbench).toBeUndefined();
    });
  });

  describe("when a newer version lands and the workbench is dirty", () => {
    /** @scenario "A tab with a save on the way waits for its own answer" */
    it("says nothing while the tab's own save is still coming", async () => {
      const reloadFromServer = vi.fn(async () => undefined);
      renderHook(() =>
        useWorkbenchUpdateListener({
          projectId: "project-1",
          experimentSlug: "my-exp",
          isDirty: true,
          reloadFromServer,
        }),
      );

      emitSignal(6);

      // Autosave arms on every change, so unsaved edits mean an answer is on
      // its way. Interrupting the reader now is what put a conflict banner in
      // front of them for Langy's work in their own tab.
      await waitFor(() => expect(sseCalls.length).toBeGreaterThan(0));
      expect(useEvaluationsV3Store.getState().staleWorkbench).toBeUndefined();
      expect(reloadFromServer).not.toHaveBeenCalled();
    });

    /** @scenario A backend edit never clobbers a workbench with unsaved changes */
    it("banners once autosave has stood down and nothing else is coming", async () => {
      const reloadFromServer = vi.fn(async () => undefined);
      // The refused save already stood autosave down; this is the state a tab
      // is left in when the server rejected its write.
      act(() => {
        useEvaluationsV3Store
          .getState()
          .setStaleWorkbench({ serverVersion: 5 });
      });
      renderHook(() =>
        useWorkbenchUpdateListener({
          projectId: "project-1",
          experimentSlug: "my-exp",
          isDirty: true,
          reloadFromServer,
        }),
      );

      emitSignal(6);

      await waitFor(() =>
        expect(useEvaluationsV3Store.getState().staleWorkbench).toEqual({
          serverVersion: 6,
          actorLabel: "langy",
        }),
      );
      expect(reloadFromServer).not.toHaveBeenCalled();
    });
  });

  describe("when the signal is not newer or not this experiment", () => {
    it("changes nothing", async () => {
      const reloadFromServer = vi.fn(async () => undefined);
      renderHook(() =>
        useWorkbenchUpdateListener({
          projectId: "project-1",
          experimentSlug: "my-exp",
          isDirty: false,
          reloadFromServer,
        }),
      );

      emitSignal(4);
      emitSignal(9, "some-other-exp");

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(reloadFromServer).not.toHaveBeenCalled();
      expect(useEvaluationsV3Store.getState().staleWorkbench).toBeUndefined();
    });
  });

  describe("when the tab becomes visible again", () => {
    /** @scenario A returning tab detects staleness and reloads a clean workbench */
    it("probes the version and applies the same rule", async () => {
      fetchVersion.mockResolvedValue({
        experimentId: "experiment_1",
        version: 7,
        updatedAt: new Date(),
      });
      const reloadFromServer = vi.fn(async () => undefined);
      renderHook(() =>
        useWorkbenchUpdateListener({
          projectId: "project-1",
          experimentSlug: "my-exp",
          isDirty: false,
          reloadFromServer,
        }),
      );

      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      await waitFor(() => expect(fetchVersion).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(reloadFromServer).toHaveBeenCalledTimes(1));
    });

    /** @scenario "A change Langy made is named as Langy's" */
    it("carries who wrote it into the banner, rather than a stranger", async () => {
      fetchVersion.mockResolvedValue({
        experimentId: "experiment_1",
        version: 7,
        updatedAt: new Date(),
        actorLabel: "langy",
      });
      // Dirty with autosave already stood down: the one state where the probe
      // is the only word there is, so its banner is the one the reader sees.
      act(() => {
        useEvaluationsV3Store
          .getState()
          .setStaleWorkbench({ serverVersion: 5 });
      });
      renderHook(() =>
        useWorkbenchUpdateListener({
          projectId: "project-1",
          experimentSlug: "my-exp",
          isDirty: true,
          reloadFromServer: vi.fn(async () => undefined),
        }),
      );

      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      await waitFor(() =>
        expect(useEvaluationsV3Store.getState().staleWorkbench).toEqual({
          serverVersion: 7,
          actorLabel: "langy",
        }),
      );
    });
  });
});
