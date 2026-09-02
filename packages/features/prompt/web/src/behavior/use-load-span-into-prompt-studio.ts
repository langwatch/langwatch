/**
 * Opening a traced LLM call as a prompt tab.
 *
 * A NARROWED family-local copy of
 * `platform/app/src/prompts/prompt-playground/hooks/useLoadSpanIntoPromptPlayground.ts`.
 * The platform module also exports `useGoToSpanInPlaygroundTabUrlBuilder`, which
 * the trace explorer, the span details panel and the trace drawer's prompt
 * panels all call to BUILD this address — eight importers this move may not
 * repoint — so that half stays there and only the READING half travels.
 *
 * The two addresses are the same contract, stated in two places until the trace
 * family moves: `?promptPlaygroundSpanId=<span>&action=<open-existing|create-new>`.
 *
 * The address is read from the host and cleared through it. `platform/app`
 * spread `router.query` and replaced the whole thing; `setQuery` merges, so the
 * two keys are cleared by name.
 */

import { useEffect, useRef } from "react";
import { LLM_PARAMETER_MAP } from "@langwatch/prompt-contract";
import type { ChatMessage, PromptStudioSpanResult } from "@langwatch/trace-contract";
import { DEFAULT_MODEL } from "../model/prompt-constants";
import {
  computeInitialFormValuesForPrompt,
  formSchema,
  type PromptConfigFormValues,
} from "../model/prompt-form";
import { usePromptHost } from "../model/prompt-host";
import { promptApi } from "./prompt-api";
import { usePromptProject } from "./use-prompt-project";
import { TabDataSchema } from "../model/prompt-tabs-store";
import { useDraggableTabsBrowserStore } from "./use-prompt-tabs-browser-store";

const QUERY_PARAM_PROMPT_PLAYGROUND_SPAN_ID = "promptPlaygroundSpanId";
const QUERY_PARAM_ACTION = "action";

export type PlaygroundAction = "open-existing" | "create-new";

/**
 * Hook to read and clear URL query parameters for span ID and action.
 * Single Responsibility: Extract span ID and action from URL and clean up the URL.
 * @returns Object with spanId, action, and clearParamsFromUrl function
 */
function useSpanIdFromUrl() {
  const host = usePromptHost();
  const query = host.route().query;
  const spanId = query[QUERY_PARAM_PROMPT_PLAYGROUND_SPAN_ID] ?? null;
  const rawAction = query[QUERY_PARAM_ACTION];
  const action: PlaygroundAction | null =
    rawAction === "open-existing" || rawAction === "create-new" ? rawAction : null;

  /** Removes the two hand-off keys, leaving every other one alone. */
  const clearParamsFromUrl = () => {
    host.setQuery(
      {
        [QUERY_PARAM_PROMPT_PLAYGROUND_SPAN_ID]: void 0,
        [QUERY_PARAM_ACTION]: void 0,
      },
      { replace: true },
    );
  };

  return { spanId, action, clearParamsFromUrl };
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
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
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
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
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
  spanData: PromptStudioSpanResult,
): PromptConfigFormValues {
  if (!spanData.llmConfig?.model) {
  }

  const systemPrompt = spanData.llmConfig?.systemPrompt
    ? typeof spanData.llmConfig.systemPrompt === "string"
      ? spanData.llmConfig.systemPrompt
      : JSON.stringify(spanData.llmConfig.systemPrompt)
    : "";

  if (systemPrompt.length === 0) {
  }

  // Build LLM config dynamically from the parameter map
  const llm: Record<string, unknown> = {
    model: spanData.llmConfig.model || DEFAULT_MODEL,
  };

  for (const param of LLM_PARAMETER_MAP) {
    const raw = (spanData.llmConfig as Record<string, unknown>)[param.formField];
    const coerced = param.coercion === "number" ? coerceToNumber(raw) : coerceToString(raw);
    if (coerced !== undefined) {
      llm[param.formField] = coerced;
    }
  }

  return formSchema.parse({
    handle: null,
    scope: "PROJECT",
    version: {
      // A LIVE DEFECT THIS MOVE FOUND, fixed here because the fix is one line
      // in a package the deletes-only ruling allows repointing — the datasets
      // family's call, second use. `formSchema`'s `version.parameters` had its
      // schema default REMOVED ("the form always provides this field"), and
      // this builder never did, so `formSchema.parse` threw on every span
      // hand-off that did not resolve to a managed prompt: "Open in Prompts"
      // from a trace has been failing outright. Both of the suites that cover
      // this function were red in `platform/app` — one of them was in no test
      // lane at all and never ran — which is why nothing caught it.
      parameters: {},
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
  notify,
}: {
  promptHandle: string;
  promptVersionNumber?: number | null;
  promptTag?: string | null;
  projectId: string;
  trpc: ReturnType<typeof promptApi.useUtils>;
  /** The screen's own way of telling the reader; the host's, one level up. */
  notify: (notice: { title: string; description?: string }) => void;
}): Promise<{
  formValues: PromptConfigFormValues;
  versionNumber: number;
} | null> {
  try {
    const prompt = await trpc.prompts.getByIdOrHandle.fetch({
      idOrHandle: promptHandle,
      projectId,
      ...(promptTag ? { tag: promptTag } : { version: promptVersionNumber ?? undefined }),
    });

    if (!prompt) {
      notify({
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
      notify({
        title: "Version not found",
        description: `Version ${promptVersionNumber} of "${promptHandle}" was not found. Opened latest version (${prompt.version}) instead.`,
      });
    }

    return { formValues, versionNumber: prompt.version };
  } catch {
    if (promptTag) {
      notify({
        title: "Tag not resolved",
        description: `Tag "${promptTag}" could not be resolved for "${promptHandle}". Opening from trace data instead.`,
      });
    } else {
      notify({
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
  const existingIdentifiers = new Set(existingInputs.map((input) => input.identifier));

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
  const host = usePromptHost();
  const { project } = usePromptProject();
  const { spanId, action, clearParamsFromUrl } = useSpanIdFromUrl();
  const trpc = promptApi.useUtils();
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
        if (effectiveAction === "open-existing" && spanData.promptHandle && hasPromptReference) {
          const existingPrompt = await tryOpenExistingPromptTab({
            promptHandle: spanData.promptHandle,
            promptVersionNumber: spanData.promptVersionNumber,
            promptTag: spanData.promptTag,
            projectId: project.id,
            trpc,
            notify: (notice) => host.succeeded(notice),
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
        removeTab({ tabId: loadingTabId });
        host.failed({
          error,
          fallbackTitle: "Couldn't open this span in the prompt playground",
        });
      }
    })();

    loadedRef.current = true;
  }, [
    spanId,
    action,
    project?.id,
    trpc.spans.getForPromptStudio,
    clearParamsFromUrl,
    addTab,
    updateTabData,
    removeTab,
  ]);
}
