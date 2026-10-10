/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _useWorkflowStore } from "../../../behavior/use-workflow-store.ts";
import { WorkflowAutosave } from "../workflow-autosave.tsx";

const store = () => _useWorkflowStore.getState();

/** A loaded workflow whose last autosave is behind one edit. */
function editAfterLoad() {
  act(() => {
    store().setAutosavedWorkflow(store().getWorkflow());
    store().setWorkflow({ name: `Edited ${Math.random()}` });
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function renderAutosave({
  isConnected,
  onSave,
}: {
  isConnected: boolean;
  onSave: Parameters<typeof WorkflowAutosave>[0]["onSave"];
}) {
  const onRefreshVersions = vi.fn(() => Promise.resolve());
  const view = renderWithDesignSystem(
    <WorkflowAutosave
      isWorkflowReady
      isConnected={isConnected}
      onSave={onSave}
      onRefreshVersions={onRefreshVersions}
    />,
  );
  const reconnect = () =>
    view.rerender(
      <WorkflowAutosave
        isWorkflowReady
        isConnected
        onSave={onSave}
        onRefreshVersions={onRefreshVersions}
      />,
    );
  return { reconnect };
}

describe("WorkflowAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("given the studio is disconnected", () => {
    /** @scenario Edits made while disconnected save when the connection returns */
    it("holds the edit and saves it once the connection returns", async () => {
      const onSave = vi.fn(() => Promise.resolve({ version: "1", id: "version-1" }));
      editAfterLoad();
      const { reconnect } = renderAutosave({ isConnected: false, onSave });

      await advance(60_000);
      expect(onSave).not.toHaveBeenCalled();
      expect(screen.queryByText(/fail/i)).toBeNull();

      reconnect();
      await advance(1_000);
      expect(onSave).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a save does not go through", () => {
    /** @scenario A save that does not go through is retried, never shown as failed */
    it("shows no failure and sends the same change again", async () => {
      const onSave = vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ version: "1", id: "version-1" });
      editAfterLoad();
      renderAutosave({ isConnected: true, onSave });

      await advance(1_000);
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/fail/i)).toBeNull();

      await advance(5_000);
      expect(onSave).toHaveBeenCalledTimes(2);
      expect(onSave.mock.calls[1]?.[0]).toEqual(onSave.mock.calls[0]?.[0]);
      expect(screen.getByText("Saved")).toBeTruthy();
    });
  });
});
