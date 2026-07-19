import { useEffect, useRef, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { AiActionError } from "~/server/app-layer/traces/ai-query";
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
  error: AiActionError | null;
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
  const recordAiTranslation = useFilterStore((s) => s.recordAiTranslation);
  const createLens = useViewStore((s) => s.createLens);
  const [error, setError] = useState<AiActionError | null>(null);
  // Track the prompt across the async boundary so onSuccess can save it
  // alongside the model's response — no plumbing through the mutation
  // result, which is keyed off the server reply only.
  const lastSubmittedPromptRef = useRef<string>("");
  // Pin the project id at submit time so a late-arriving response can't
  // record the translation against the wrong project if the user
  // navigated workspaces while the request was in flight.
  const lastSubmittedProjectIdRef = useRef<string | null>(null);

  // If the hosting composer unmounts (user closed it, navigated away,
  // reopened it for a new prompt), drop the in-flight mutation's response
  // so a stale reply never mutates global filter/lens state.
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const aiAction = api.tracesV2.aiAction.useMutation({
    onSuccess: (result) => {
      if (cancelledRef.current) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Apply the query first so the resulting view is filtered (also so
      // that lens creation captures the right snapshot).
      applyQueryText(result.query);
      // Pin the user's natural-language prompt against the produced
      // query. Next time the user enters AI mode, if the URL query is
      // still this exact string, the search bar reads the prompt back
      // out of the store instead of seeding the composer with the
      // (already-displayed) generated query — they get to keep editing
      // their original wording rather than start from the syntax.
      if (lastSubmittedProjectIdRef.current && lastSubmittedPromptRef.current) {
        recordAiTranslation({
          projectId: lastSubmittedProjectIdRef.current,
          prompt: lastSubmittedPromptRef.current,
          query: result.query,
        });
      }
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
      if (cancelledRef.current) return;
      // tRPC-layer failures (network blip, ModelNotConfiguredError, etc.)
      // arrive here with a string message. Wrap them in the same
      // structured shape the server returns for handled failures so the
      // composer renders a single error path.
      setError({ code: "unknown", message: e.message });
    },
  });

  const submit = (prompt: string): void => {
    if (!project?.id || !prompt.trim() || aiAction.isPending) return;
    const trimmed = prompt.trim();
    lastSubmittedPromptRef.current = trimmed;
    lastSubmittedProjectIdRef.current = project.id;
    setError(null);
    aiAction.mutate({
      projectId: project.id,
      prompt: trimmed,
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
