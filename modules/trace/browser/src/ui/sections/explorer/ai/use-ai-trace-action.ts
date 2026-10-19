import { isAggregateProjectKind } from "@langwatch/project-contract";
import type {
  AiActionError,
  AiActionErrorDetails,
  AiActionResult,
} from "@langwatch/trace-contract";
import { useEffect, useRef, useState } from "react";

import { useFilterStore, useViewStore } from "../../../../behavior/explorer.store.ts";
import { api } from "../../../../behavior/trace-api.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { type AppErrorCode, readHandledError } from "../../errors/index.ts";

/**
 * Lifts the composer's detail rows out of a handled error's `meta`.
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

const READ_ONLY_CODE: AppErrorCode = "aggregate_project_is_read_only";

/**
 * A lens asked for on an aggregate project (ADR-177): the store refuses it silently, so the
 * action answers with the server's read-only envelope and the composer shows its copy.
 */
const LENS_REFUSED_ON_AGGREGATE: AiActionError = {
  code: READ_ONLY_CODE,
  cause: { error: { code: READ_ONLY_CODE }, httpStatus: 403 },
};

export type AiTraceActionMode =
  /** Filter-only: applies a query, never creates a lens. */
  | "filter"
  /** Lens-only: always creates a new lens (and applies the query inside it). */
  | "lens"
  /** Either: the model picks based on the user's intent. */
  | "auto";

/**
 * The name of the lens this answer should create, or null when it creates
 * none: `lens` mode always makes one, `auto` only when the model asked.
 */
function lensNameFor({
  mode,
  result,
}: {
  mode: AiTraceActionMode;
  result: AiActionResult;
}): string | null {
  if (result.kind === "create_lens" && mode !== "filter") return result.name;
  return mode === "lens" ? "Untitled lens" : null;
}

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
 * Glue between the generic `AiPromptInput` and the trace-specific stores. Handles the
 * tRPC `aiAction` mutation, error capture, and dispatching the resulting action against
 * `filterStore` / `viewStore`.
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
  const projectAcceptsWrites = !isAggregateProjectKind(project?.kind);
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

  const aiAction = api.traces.aiAction.useMutation({
    onSuccess: (result) => {
      if (cancelledRef.current) return;
      // Apply the query first so the resulting view is filtered (also so
      // that lens creation captures the right snapshot).
      applyQueryText(result.query);
      // Pin the prompt against the produced query, so re-entering AI mode on the
      // same query reopens the user's wording rather than the generated syntax.
      if (lastSubmittedProjectIdRef.current && lastSubmittedPromptRef.current) {
        recordAiTranslation({
          projectId: lastSubmittedProjectIdRef.current,
          prompt: lastSubmittedPromptRef.current,
          query: result.query,
        });
      }
      const lensName = lensNameFor({ mode, result });
      // The query above still applies, since reading is allowed; only the
      // lens is refused. The composer stays open with the refusal, rather
      // than closing as if the lens had been saved.
      if (lensName !== null && !projectAcceptsWrites) {
        setError(LENS_REFUSED_ON_AGGREGATE);
        return;
      }
      if (lensName !== null) createLens(lensName);
      onDone?.();
    },
    onError: (e) => {
      if (cancelledRef.current) return;
      // Every failure arrives here now — the AI-search failure itself
      // (`ai_query_provider_error`), a `model_not_configured`, a permission rejection,
      // a network blip.
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
