import { useEffect, useRef, useState } from "react";
import { readHandledError } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type {
  AiActionError,
  AiActionErrorDetails,
} from "~/server/app-layer/traces/ai-query";
import { api } from "~/utils/api";
import { useFilterStore } from "../../stores/filterStore";
import { useViewStore } from "../../stores/viewStore";

/**
 * Lifts the composer's detail rows out of a handled error's `meta`.
 *
 * `meta` is a per-code contract, and this is the reader end of the one
 * `ai_query_provider_error` declares — provider, model, status, the provider's
 * own reason and the query the model last produced. Nothing here is copy: it
 * fills the "View details" disclosure an operator opens when the registry's
 * remediation wasn't enough. Untrusted, so every field is checked.
 */
function readAiErrorDetails(
  meta: Record<string, unknown> | undefined,
): AiActionErrorDetails | undefined {
  if (!meta) return undefined;
  const text = (key: string): string | undefined => {
    const value = meta[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };
  const status = meta.httpStatus;

  const provider = text("provider");
  const model = text("model");
  const reason = text("reason");
  const lastQuery = text("lastQuery");

  const details: AiActionErrorDetails = {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(typeof status === "number" ? { httpStatus: status } : {}),
    ...(reason ? { reason } : {}),
    ...(lastQuery ? { lastQuery } : {}),
  };
  return Object.keys(details).length > 0 ? details : undefined;
}

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
        const lensName = result.kind === "create_lens" ? result.name : "Untitled lens";
        createLens(lensName);
      }
      onDone?.();
    },
    onError: (e) => {
      if (cancelledRef.current) return;
      // Every failure arrives here now — the AI-search failure itself
      // (`ai_query_provider_error`), a `model_not_configured`, a permission
      // rejection, a network blip. Keep the handled code when there is one:
      // it is documented as the branching + telemetry key, and forcing
      // `"unknown"` meant the composer could never act on a cause it had been
      // handed (no "Review model providers" link on a provider failure, no
      // way to tell "pick a model" apart from "the model misbehaved").
      //
      // The error itself rides along as `cause` so the renderer resolves its
      // words through `explainAnyError` — which covers the handled payload,
      // a procedure's authored message, and the generic unknown state alike.
      const handled = readHandledError(e);
      setError({
        code: handled?.code ?? "unknown",
        cause: e,
        details: readAiErrorDetails(handled?.meta),
      });
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
