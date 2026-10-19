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

function renderAutosave({ onSave }: { onSave: Parameters<typeof WorkflowAutosave>[0]["onSave"] }) {
  renderWithDesignSystem(
    <WorkflowAutosave
      isWorkflowReady
      onSave={onSave}
      onRefreshVersions={vi.fn(() => Promise.resolve())}
    />,
  );
}

describe("WorkflowAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("given the engine connection is down", () => {
    /** @scenario Autosave keeps saving while the engine is away */
    it("saves the edit to the API, which the engine socket does not gate", async () => {
      const onSave = vi.fn(() => Promise.resolve({ version: "1", id: "version-1" }));
      editAfterLoad();
      renderAutosave({ onSave });

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
      renderAutosave({ onSave });

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
