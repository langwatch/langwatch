import { createLogger } from "@langwatch/observability";
import { useEffect, useRef } from "react";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { LLM_PARAMETER_MAP } from "~/prompts/prompt-playground/llmParameterMap";
import { formSchema } from "~/prompts/schemas";
import type { PromptConfigFormValues } from "~/prompts/types";
import { computeInitialFormValuesForPrompt } from "~/prompts/utils/computeInitialFormValuesForPrompt";
import type { ChatMessage } from "~/server/tracer/types";
import { api, type RouterOutputs } from "~/utils/api";
import { useSearchParams } from "~/utils/compat/next-navigation";
import { useRouter } from "~/utils/compat/next-router";
import { DEFAULT_MODEL } from "~/utils/constants";
import { getRoutePath } from "~/utils/routes";
import {
  TabDataSchema,
  useDraggableTabsBrowserStore,
} from "../prompt-playground-store/DraggableTabsBrowserStore";

const logger = createLogger("useLoadSpanIntoPromptPlayground");

const QUERY_PARAM_PROMPT_PLAYGROUND_SPAN_ID = "promptPlaygroundSpanId";
const QUERY_PARAM_PROMPT_PLAYGROUND_TRACE_ID = "promptPlaygroundTraceId";
const QUERY_PARAM_PROMPT_PLAYGROUND_TENANT_ID = "promptPlaygroundTenantId";
const QUERY_PARAM_PROMPT_PLAYGROUND_OCCURRED_AT_MS =
  "promptPlaygroundOccurredAtMs";
const QUERY_PARAM_ACTION = "action";

export type PlaygroundAction = "open-existing" | "create-new";

/**
 * The trace a playground link's span belongs to. Named, the span is read
 * through the trace's own proof, so a link opened under an aggregate loads
 * the member's span (ADR-144 block F). `tenantId` is the member that holds
 * the trace, set only under an aggregate; `occurredAtMs` narrows the read.
 */
export interface PlaygroundSpanTrace {
  traceId: string;
  tenantId?: string | null;
  occurredAtMs?: number | null;
}

/** What a playground link asks the loader to open. */
export interface PlaygroundSpanLink {
  spanId: string;
  action?: PlaygroundAction;
  trace?: PlaygroundSpanTrace;
}

/**
 * The URL that opens a span in the prompt playground of a project. Old links
 * name only the span, and still open on a plain project.
 */
export function buildPlaygroundSpanUrl({
  projectSlug,
  origin,
  spanId,
  action,
  trace,
}: PlaygroundSpanLink & { projectSlug: string; origin: string }): URL {
  const url = new URL(getRoutePath({ projectSlug, route: "prompts" }), origin);
  url.searchParams.set(QUERY_PARAM_PROMPT_PLAYGROUND_SPAN_ID, spanId);
  if (trace) {
    url.searchParams.set(QUERY_PARAM_PROMPT_PLAYGROUND_TRACE_ID, trace.traceId);
    if (trace.tenantId) {
      url.searchParams.set(
        QUERY_PARAM_PROMPT_PLAYGROUND_TENANT_ID,
        trace.tenantId,
      );
    }
    if (trace.occurredAtMs != null) {
      url.searchParams.set(
        QUERY_PARAM_PROMPT_PLAYGROUND_OCCURRED_AT_MS,
        String(trace.occurredAtMs),
      );
    }
  }
  if (action) {
    url.searchParams.set(QUERY_PARAM_ACTION, action);
  }
  return url;
}

/**
 * The span read a playground link asks for, from its query parameters: the
 * span, and the trace that holds it when the link names one. A malformed
 * time hint is dropped rather than sent, so the read falls back to an
 * unhinted one.
 */
export function readPlaygroundSpanParams(
  searchParams: { get: (name: string) => string | null } | null | undefined,
): {
  spanId: string | null;
  action: PlaygroundAction | null;
  trace: { traceId: string; tenantId?: string; occurredAtMs?: number } | null;
} {
  const spanId =
    searchParams?.get(QUERY_PARAM_PROMPT_PLAYGROUND_SPAN_ID) ?? null;
  const rawAction = searchParams?.get(QUERY_PARAM_ACTION);
  const action: PlaygroundAction | null =
    rawAction === "open-existing" || rawAction === "create-new"
      ? rawAction
      : null;
  const traceId = searchParams?.get(QUERY_PARAM_PROMPT_PLAYGROUND_TRACE_ID);
  if (!traceId) return { spanId, action, trace: null };

  const tenantId = searchParams?.get(QUERY_PARAM_PROMPT_PLAYGROUND_TENANT_ID);
  const rawOccurredAtMs = searchParams?.get(
    QUERY_PARAM_PROMPT_PLAYGROUND_OCCURRED_AT_MS,
  );
  const occurredAtMs =
    rawOccurredAtMs != null && /^\d+$/.test(rawOccurredAtMs)
      ? Number(rawOccurredAtMs)
      : undefined;
  return {
    spanId,
    action,
    trace: {
      traceId,
      ...(tenantId ? { tenantId } : {}),
      ...(occurredAtMs !== undefined && Number.isSafeInteger(occurredAtMs)
        ? { occurredAtMs }
        : {}),
    },
  };
}

/**
 * Hook for navigation to prompt playground with a span ID.
 * Single Responsibility: Navigate to prompt playground page with span query param.
 */
export function useGoToSpanInPlaygroundTabUrlBuilder() {
  const { project } = useOrganizationTeamProject();

  /**
   * buildUrl
   * Single Responsibility: Constructs URL to prompt playground page with span ID query parameter.
   * @param link.spanId - The ID of the span to load into the prompt playground
   * @param link.action - Optional action: "open-existing" to open the referenced prompt, "create-new" to always create a new tab
   * @param link.trace - Optional trace that holds the span, so the span is read through the trace's own proof
   * @returns A URL object if the project slug is available, otherwise null
   */
  const buildUrl = (link: PlaygroundSpanLink) => {
    if (!project?.slug) {
      logger.warn("Cannot build URL: project slug is missing");
      return null;
    }

    return buildPlaygroundSpanUrl({
      ...link,
      projectSlug: project.slug,
      origin: window.location.origin,
    });
  };

  return {
    /**
     * Build a URL to the prompt playground page with the given span.
     * @returns A URL object if the project slug is available, otherwise null.
     */
    buildUrl,
  };
}

/**
 * Hook to read and clear URL query parameters for the span, its trace and action.
 * Single Responsibility: Extract the span link from URL and clean up the URL.
 * @returns Object with spanId, trace, action, and clearParamsFromUrl function
 */
function useSpanIdFromUrl() {
  const searchParams = useSearchParams();
  const { spanId, action, trace } = readPlaygroundSpanParams(searchParams);
  const router = useRouter();

  /**
   * clearParamsFromUrl
   * Single Responsibility: Removes the span link query parameters from URL without full page reload.
   */
  const clearParamsFromUrl = () => {
    const {
      [QUERY_PARAM_PROMPT_PLAYGROUND_SPAN_ID]: _spanId,
      [QUERY_PARAM_PROMPT_PLAYGROUND_TRACE_ID]: _traceId,
      [QUERY_PARAM_PROMPT_PLAYGROUND_TENANT_ID]: _tenantId,
      [QUERY_PARAM_PROMPT_PLAYGROUND_OCCURRED_AT_MS]: _occurredAtMs,
      [QUERY_PARAM_ACTION]: _action,
      ...query
    } = router.query;
    void router.replace({ pathname: router.pathname, query }, undefined, {
      shallow: true,
    });
  };

  return { spanId, action, trace, clearParamsFromUrl };
}

/**
 * Safely coerces a value to a number, returning undefined for anything that
 * cannot be cleanly converted. Trace data may store numeric LLM params as
 * strings (e.g. "0.7"), booleans, or objects -- this function handles all
 * of those without throwing.
 *
 * @param value - The value to coerce (number, string, null, or unknown)
 * @returns The numeric value, or undefined if coercion is not possible
 */
export function coerceToNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Safely coerces a value to a string, returning undefined for anything that
 * cannot be meaningfully converted. Nulls, undefined, objects, and arrays
 * are rejected.  Numbers and booleans are converted via String().
 *
 * @param value - The value to coerce
 * @returns The string value, or undefined if coercion is not possible
 */
export function coerceToString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value === "" ? undefined : value;
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === "boolean") return String(value);
  return undefined;
}

/**
 * Creates default form values for a new prompt config.
 * Single Responsibility: Generate initial prompt configuration structure from span data.
 *
 * Applies lenient coercion to numeric fields because trace data from customer
 * LLM calls may store parameters as strings instead of numbers.  Values that
 * cannot be coerced are silently dropped (set to undefined) so that the
 * "Open in Prompts" flow never fails due to unexpected trace data shapes.
 *
 * @param spanData - The span data containing LLM configuration
 * @returns Initial form values for a new prompt
 */
export function createDefaultPromptFormValues(
  spanData: RouterOutputs["spans"]["getForPromptStudio"],
): PromptConfigFormValues {
  if (!spanData.llmConfig?.model) {
    logger.warn(
      { spanData },
      "Model is not available for span data. This is not expected.",
    );
  }

  const systemPrompt = spanData.llmConfig?.systemPrompt
    ? typeof spanData.llmConfig.systemPrompt === "string"
      ? spanData.llmConfig.systemPrompt
      : JSON.stringify(spanData.llmConfig.systemPrompt)
    : "";

  if (systemPrompt.length === 0) {
    logger.warn({ spanData }, "System prompt is empty. This is not expected.");
  }

  // Build LLM config dynamically from the parameter map
  const llm: Record<string, unknown> = {
    model: spanData.llmConfig.model || DEFAULT_MODEL,
  };

  for (const param of LLM_PARAMETER_MAP) {
    const raw = (spanData.llmConfig as Record<string, unknown>)[
      param.formField
    ];
    const coerced =
      param.coercion === "number" ? coerceToNumber(raw) : coerceToString(raw);
    if (coerced !== undefined) {
      llm[param.formField] = coerced;
    }
  }

  return formSchema.parse({
    handle: null,
    scope: "PROJECT",
    version: {
      configData: {
        prompt: systemPrompt,
        llm,
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
        messages: [{ role: "system", content: systemPrompt }],
      },
    },
  });
}

/**
 * Adds a unique ID to each message.
 * Single Responsibility: Transforms message array by adding trace ID to each message.
 * @param messages - Array of chat messages without IDs
 * @param traceId - The trace ID to assign to messages
 * @returns Array of messages with ID field added
 */
function addIdToMessages(
  messages: Array<ChatMessage>,
  traceId: string,
): Array<ChatMessage & { id: string }> {
  return messages.map((message) => ({
    ...message,
    id: traceId,
  }));
}

/**
 * Opens a tab for an existing LangWatch-managed prompt at a specific version.
 * Falls back to creating a new tab from trace data if the prompt is not found.
 *
 * @returns The tab data to add, or null to fall back to new-tab-from-trace behavior
 */
async function tryOpenExistingPromptTab({
  promptHandle,
  promptVersionNumber,
  promptTag,
  projectId,
  trpc,
}: {
  promptHandle: string;
  promptVersionNumber?: number | null;
  promptTag?: string | null;
  projectId: string;
  trpc: ReturnType<typeof api.useUtils>;
}): Promise<{
  formValues: PromptConfigFormValues;
  versionNumber: number;
} | null> {
  try {
    const prompt = await trpc.prompts.getByIdOrHandle.fetch({
      idOrHandle: promptHandle,
      projectId,
      ...(promptTag
        ? { tag: promptTag }
        : { version: promptVersionNumber ?? undefined }),
    });

    if (!prompt) {
      toaster.create({
        title: "Prompt not found",
        description: `The prompt "${promptHandle}" was not found in this project. Opening from trace data instead.`,
      });
      return null;
    }

    const formValues = computeInitialFormValuesForPrompt({
      prompt,
      useSystemMessage: true,
    });

    // If the requested version differs from what was returned, the version was not found
    // Only check when fetching by version number — tag fetches skip this check
    if (promptVersionNumber != null && prompt.version !== promptVersionNumber) {
      toaster.create({
        title: "Version not found",
        description: `Version ${promptVersionNumber} of "${promptHandle}" was not found. Opened latest version (${prompt.version}) instead.`,
      });
    }

    return { formValues, versionNumber: prompt.version };
  } catch {
    if (promptTag) {
      toaster.create({
        title: "Tag not resolved",
        description: `Tag "${promptTag}" could not be resolved for "${promptHandle}". Opening from trace data instead.`,
      });
    } else {
      toaster.create({
        title: "Prompt not found",
        description: `Could not load prompt "${promptHandle}". Opening from trace data instead.`,
      });
    }
    return null;
  }
}

/**
 * Merges traced variables into an existing prompt's inputs.
 * For variables that exist in the prompt's input schema, fills them.
 * For variables NOT in the prompt's input schema, adds them as new inputs.
 *
 * @param formValues - The existing prompt form values
 * @param promptVariables - The traced variable values
 * @returns Updated form values with merged inputs
 */
function mergeTracedVariablesIntoInputs(
  formValues: PromptConfigFormValues,
  promptVariables: Record<string, string>,
): PromptConfigFormValues {
  const existingInputs = formValues.version?.configData?.inputs ?? [];
  const existingIdentifiers = new Set(
    existingInputs.map((input) => input.identifier),
  );

  const newInputs = Object.keys(promptVariables)
    .filter((key) => !existingIdentifiers.has(key))
    .map((key) => ({ identifier: key, type: "str" as const }));

  if (newInputs.length === 0) {
    return formValues;
  }

  return {
    ...formValues,
    version: {
      ...formValues.version,
      configData: {
        ...formValues.version.configData,
        inputs: [...existingInputs, ...newInputs],
      },
    },
  };
}

/**
 * Hook to load span data from a trace into the prompt studio.
 * When the span references a LangWatch-managed prompt (via promptHandle),
 * opens the existing prompt at the recorded version. Otherwise, creates
 * a new tab from the trace data.
 *
 * Supports an `action` URL parameter:
 * - "open-existing": open the referenced prompt at the traced version
 * - "create-new": always create a new tab from trace data
 * - absent: auto-detect based on whether promptHandle is present
 */
export function useLoadSpanIntoPromptPlayground() {
  const loadedRef = useRef(false);
  const { project } = useOrganizationTeamProject();
  const { spanId, action, trace, clearParamsFromUrl } = useSpanIdFromUrl();
  const trpc = api.useUtils();
  const { addTab, updateTabData, removeTab } = useDraggableTabsBrowserStore(
    ({ addTab, updateTabData, removeTab }) => ({
      addTab,
      updateTabData,
      removeTab,
    }),
  );

  useEffect(() => {
    if (!spanId || loadedRef.current || !project?.id) return;

    clearParamsFromUrl();

    // Create a placeholder loading tab immediately so the user sees feedback
    const loadingTabId = addTab({
      data: TabDataSchema.parse({
        loading: true,
        form: { currentValues: {} },
        meta: { title: "Loading..." },
      }),
    });

    void (async () => {
      try {
        const spanData = await trpc.spans.getForPromptStudio.fetch({
          projectId: project.id,
          spanId: spanId,
          ...(trace ?? {}),
        });

        if (!spanData) {
          removeTab({ tabId: loadingTabId });
          return;
        }

        // Build chat messages from the trace (excluding system prompt, which goes into the form config)
        const chatMessages = addIdToMessages(
          spanData.messages.filter((m) => m.role !== "system"),
          spanData.traceId,
        );

        const variables = spanData.promptVariables ?? {};

        const hasPromptReference =
          spanData.promptHandle &&
          (spanData.promptVersionNumber != null || spanData.promptTag != null);

        // Determine effective action: explicit or auto-detected from prompt reference
        const effectiveAction: PlaygroundAction =
          action ?? (hasPromptReference ? "open-existing" : "create-new");

        // When action is "open-existing" and span references a managed prompt
        if (
          effectiveAction === "open-existing" &&
          spanData.promptHandle &&
          hasPromptReference
        ) {
          const existingPrompt = await tryOpenExistingPromptTab({
            promptHandle: spanData.promptHandle,
            promptVersionNumber: spanData.promptVersionNumber,
            promptTag: spanData.promptTag,
            projectId: project.id,
            trpc,
          });

          if (existingPrompt) {
            const mergedValues = mergeTracedVariablesIntoInputs(
              existingPrompt.formValues,
              variables,
            );

            updateTabData({
              tabId: loadingTabId,
              updater: () =>
                TabDataSchema.parse({
                  loading: false,
                  form: {
                    currentValues: mergedValues,
                  },
                  chat: {
                    initialMessagesFromSpanData: chatMessages,
                  },
                  meta: {
                    title: mergedValues.handle ?? null,
                    versionNumber: existingPrompt.versionNumber,
                  },
                  variableValues: variables,
                }),
            });
            return;
          }
        }

        // Fall back: create new tab from trace data
        const defaultValues = createDefaultPromptFormValues(spanData);

        updateTabData({
          tabId: loadingTabId,
          updater: () =>
            TabDataSchema.parse({
              loading: false,
              form: {
                currentValues: defaultValues,
              },
              chat: {
                initialMessagesFromSpanData: chatMessages,
              },
              variableValues: variables,
            }),
        });
      } catch (error) {
        logger.error({ error }, "Error loading span data into prompt studio");
        removeTab({ tabId: loadingTabId });
        showErrorToast({
          error,
          fallbackTitle: "Couldn't open this span in the prompt playground",
        });
      }
    })();

    loadedRef.current = true;
  }, [
    spanId,
    action,
    trace,
    project?.id,
    trpc.spans.getForPromptStudio,
    clearParamsFromUrl,
    addTab,
    updateTabData,
    removeTab,
  ]);
}
