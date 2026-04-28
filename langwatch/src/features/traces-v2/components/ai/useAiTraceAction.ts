import { useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useFilterStore } from "../../stores/filterStore";
import { useViewStore } from "../../stores/viewStore";

export type AiTraceActionMode =
  /** Filter-only: applies a query, never creates a lens. */
  | "filter"
  /** Lens-only: always creates a new lens (and applies the query inside it). */
  | "lens"
  /** Either: the model picks based on the user's intent. */
  | "auto";

interface UseAiTraceActionOptions {
  /** Which kinds of actions this caller is willing to perform. */
  mode?: AiTraceActionMode;
  /**
   * Called once the action successfully dispatches against the store.
   * Use it to close the popover/composer that hosts the prompt input.
   */
  onDone?: () => void;
}

interface UseAiTraceActionResult {
  submit: (prompt: string) => void;
  isPending: boolean;
  error: string | null;
  /** Resets the error state — call from the prompt input's `onPromptChange`. */
  clearError: () => void;
}

/**
 * Glue between the generic `AiPromptInput` and the trace-specific stores.
 * Handles the tRPC `aiAction` mutation, error capture, and dispatching the
 * resulting action against `filterStore` / `viewStore`. Each consumer can
 * pick which actions it wants to support via `mode`.
 *
 * - `filter` mode forces the action into `apply_query` regardless of what
 *   the model returned (the lens name is dropped, only the query is
 *   applied). Use this in the search bar.
 * - `lens` mode always creates a lens with the model's name (or "Untitled
 *   lens" if the model only returned a filter). Use this in CreateLens
 *   popovers.
 * - `auto` lets the model pick — current search bar behaviour.
 */
export function useAiTraceAction({
  mode = "auto",
  onDone,
}: UseAiTraceActionOptions = {}): UseAiTraceActionResult {
  const { project } = useOrganizationTeamProject();
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);
  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  const createLens = useViewStore((s) => s.createLens);
  const [error, setError] = useState<string | null>(null);

  const aiAction = api.tracesV2.aiAction.useMutation({
    onSuccess: (result) => {
      if (!result.ok) {
        setError(`Couldn't understand that. ${result.error}`);
        return;
      }
      // Apply the query first so the resulting view is filtered (also so
      // that lens creation captures the right snapshot).
      applyQueryText(result.query);
      const shouldCreateLens =
        mode === "lens" || (mode === "auto" && result.kind === "create_lens");
      if (shouldCreateLens) {
        const lensName =
          result.kind === "create_lens" ? result.name : "Untitled lens";
        createLens(lensName);
      }
      onDone?.();
    },
    onError: (e) => {
      setError(e.message);
    },
  });

  const submit = (prompt: string): void => {
    if (!project?.id || !prompt.trim() || aiAction.isPending) return;
    setError(null);
    aiAction.mutate({
      projectId: project.id,
      prompt: prompt.trim(),
      timeRange: { from: timeRange.from, to: timeRange.to },
    });
  };

  return {
    submit,
    isPending: aiAction.isPending,
    error,
    clearError: () => setError(null),
  };
}
