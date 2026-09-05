/**
 * Opening a traced LLM call as a prompt tab. A NARROWED copy of
 * `useLoadSpanIntoPromptPlayground.ts` — only the READING half travels here;
 * the URL-building half stays in `platform/app`.
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
 * Safely coerces a value to a number (trace data may store it as a string).
 * @param value - The value to coerce
 * @returns The numeric value, or undefined if not coercible
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
 * Safely coerces a value to a string; nulls/objects/arrays are rejected.
 * @param value - The value to coerce
 * @returns The string value, or undefined if not coercible
 */
export function coerceToString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value === "" ? undefined : value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === "boolean") return String(value);
  return undefined;
}

/**
 * Creates default form values for a new prompt config from span data.
 * @param spanData - The span data containing LLM configuration
 * @returns Initial form values for a new prompt
 */
export function createDefaultPromptFormValues(
  spanData: PromptStudioSpanResult,
): PromptConfigFormValues {
  const systemPrompt = spanData.llmConfig?.systemPrompt
    ? typeof spanData.llmConfig.systemPrompt === "string"
      ? spanData.llmConfig.systemPrompt
      : JSON.stringify(spanData.llmConfig.systemPrompt)
    : "";

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
      // A LIVE DEFECT THIS MOVE FOUND: `formSchema`'s `version.parameters` had
      // its schema default REMOVED, and this builder never supplied one, so
      // `formSchema.parse` threw on every unmanaged-prompt hand-off. Both
      // covering suites were red in `platform/app`, one in no test lane at all.
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
 * @param messages - Array of chat messages without IDs
 * @param traceId - The trace ID to assign to messages
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
 * Falls back to creating a new tab from trace data if not found.
 * @returns The tab data to add, or null to fall back to new-tab-from-trace
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
 * Merges traced variables into a prompt's inputs, filling known ones and
 * adding the rest as new inputs.
 * @param formValues - The existing prompt form values
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
 * Hook to load span data from a trace into the prompt studio: opens the
 * managed prompt at its recorded version (via promptHandle) or creates a new
 * tab from trace data. The `action` URL parameter can force either behavior.
 */
export function useLoadSpanIntoPromptPlayground() {
  const loadedRef = useRef(false);
  const host = usePromptHost();
  const { project } = usePromptProject();
  const { spanId, action, clearParamsFromUrl } = useSpanIdFromUrl();
  const trpc = promptApi.useUtils();
  const addTab = useDraggableTabsBrowserStore((state) => state.addTab);
  const updateTabData = useDraggableTabsBrowserStore((state) => state.updateTabData);
  const removeTab = useDraggableTabsBrowserStore((state) => state.removeTab);

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
