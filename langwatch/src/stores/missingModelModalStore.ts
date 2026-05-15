import { create } from "zustand";

/**
 * Payload carried by a `ModelNotConfiguredError` after the resolver fails to
 * pick a model for a feature. Mirrors the wire shape thrown by
 * `resolveModelForFeature` (see `specs/model-providers/model-resolver-and-registry.feature`).
 */
export type MissingModelInfo = {
  /** Stable, area-prefixed snake_case key (e.g. "traces.ai_search"). */
  featureKey: string;
  /** User-facing label for the feature, from the dev-side registry. */
  featureDisplayName: string;
  /** Role the unresolved feature belongs to. */
  role: "DEFAULT" | "FAST" | "EMBEDDINGS";
  /** Project the resolve call was made for, if any. */
  projectId?: string;
};

interface MissingModelModalState {
  isOpen: boolean;
  info: MissingModelInfo | null;
  open: (info: MissingModelInfo) => void;
  close: () => void;
}

/**
 * Global store for the "Model not configured" modal. Opened by the tRPC /
 * Hono error interceptors when an API call surfaces a
 * ModelNotConfiguredError. The same store is closed by the modal itself or
 * navigated away by the modal's CTA.
 *
 * Identical (featureKey, role) errors arriving in quick succession only
 * re-open the modal if it is already closed — the open() implementation
 * deduplicates while the modal is on screen.
 */
export const useMissingModelModalStore = create<MissingModelModalState>(
  (set, get) => ({
    isOpen: false,
    info: null,
    open: (info) => {
      const current = get();
      if (
        current.isOpen &&
        current.info?.featureKey === info.featureKey &&
        current.info?.role === info.role
      ) {
        // Same feature already on screen — keep the existing modal, don't
        // remount on every retry of the same failing call.
        return;
      }
      set({ isOpen: true, info });
    },
    close: () => set({ isOpen: false, info: null }),
  }),
);
