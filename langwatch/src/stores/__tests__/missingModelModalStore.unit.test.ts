import { beforeEach, describe, expect, it } from "vitest";
import {
  type MissingModelInfo,
  useMissingModelModalStore,
} from "../missingModelModalStore";

const FEATURE_AI_SEARCH: MissingModelInfo = {
  featureKey: "traces.ai_search",
  featureDisplayName: "AI search",
  role: "FAST",
  projectId: "proj-1",
};

const FEATURE_AUTOCOMPLETE: MissingModelInfo = {
  featureKey: "studio.autocomplete",
  featureDisplayName: "Autocomplete",
  role: "FAST",
  projectId: "proj-1",
};

describe("useMissingModelModalStore", () => {
  beforeEach(() => {
    useMissingModelModalStore.getState().close();
  });

  it("opens with the info when called and closes back to a clean state", () => {
    useMissingModelModalStore.getState().open(FEATURE_AI_SEARCH);
    const open = useMissingModelModalStore.getState();
    expect(open.isOpen).toBe(true);
    expect(open.info).toEqual(FEATURE_AI_SEARCH);

    open.close();
    const closed = useMissingModelModalStore.getState();
    expect(closed.isOpen).toBe(false);
    expect(closed.info).toBeNull();
  });

  /** @scenario Identical errors in quick succession only open one modal */
  it("deduplicates identical (featureKey, role) errors while the modal is open", () => {
    useMissingModelModalStore.getState().open(FEATURE_AI_SEARCH);
    const first = useMissingModelModalStore.getState().info;
    // Five retries fire in two seconds; nothing should re-mount the modal.
    for (let i = 0; i < 5; i++) {
      useMissingModelModalStore.getState().open(FEATURE_AI_SEARCH);
    }
    const second = useMissingModelModalStore.getState().info;
    // Same object reference proves no `set` ran on the duplicates.
    expect(second).toBe(first);
    expect(useMissingModelModalStore.getState().isOpen).toBe(true);
  });

  /** @scenario A different feature still opens its own modal even within the debounce window */
  it("replaces the open modal when a different (featureKey, role) error arrives", () => {
    useMissingModelModalStore.getState().open(FEATURE_AI_SEARCH);
    useMissingModelModalStore.getState().open(FEATURE_AUTOCOMPLETE);
    expect(useMissingModelModalStore.getState().info).toEqual(
      FEATURE_AUTOCOMPLETE,
    );
    expect(useMissingModelModalStore.getState().isOpen).toBe(true);
  });

  it("opens again after close, even for the same feature", () => {
    useMissingModelModalStore.getState().open(FEATURE_AI_SEARCH);
    useMissingModelModalStore.getState().close();
    useMissingModelModalStore.getState().open(FEATURE_AI_SEARCH);
    expect(useMissingModelModalStore.getState().isOpen).toBe(true);
    expect(useMissingModelModalStore.getState().info).toEqual(
      FEATURE_AI_SEARCH,
    );
  });
});
