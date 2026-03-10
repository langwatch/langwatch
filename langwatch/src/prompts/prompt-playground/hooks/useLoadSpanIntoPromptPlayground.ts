import { useSearchParams } from "next/navigation";
import { useRouter } from "next/router";
import { useEffect, useRef } from "react";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { formSchema } from "~/prompts/schemas";
import type { PromptConfigFormValues } from "~/prompts/types";
import { LLM_PARAMETER_MAP } from "~/prompts/prompt-playground/llmParameterMap";
import { computeInitialFormValuesForPrompt } from "~/prompts/utils/computeInitialFormValuesForPrompt";
import type { ChatMessage } from "~/server/tracer/types";
import { api, type RouterOutputs } from "~/utils/api";
import { DEFAULT_MODEL } from "~/utils/constants";
import { createLogger } from "~/utils/logger";
import { getRoutePath } from "~/utils/routes";
import {
  TabDataSchema,
  useDraggableTabsBrowserStore,
} from "../prompt-playground-store/DraggableTabsBrowserStore";

const logger = createLogger("useLoadSpanIntoPromptPlayground");

const QUERY_PARAM_PROMPT_PLAYGROUND_SPAN_ID = "promptPlaygroundSpanId";

/**
 * Hook for navigation to prompt playground with a span ID.
 * Single Responsibility: Navigate to prompt playground page with span query param.
 */
export function useGoToSpanInPlaygroundTabUrlBuilder() {
  const { project } = useOrganizationTeamProject();

  /**
   * buildUrl
   * Single Responsibility: Constructs URL to prompt playground page with span ID query parameter.
   * @param spanId - The ID of the span to load into the prompt playground
   * @returns A URL object if the project slug is available, otherwise null
   */
  const buildUrl = (spanId: string) => {
    if (!project?.slug) {
      logger.warn("Cannot build URL: project slug is missing");
      return null;
    }

    const url = new URL(
      getRoutePath({ projectSlug: project.slug, route: "prompts" }),
      window.location.origin,
    );
    url.searchParams.set(QUERY_PARAM_PROMPT_PLAYGROUND_SPAN_ID, spanId);
    return url;
  };

  return {
    /**
     * Build a URL to the prompt playground page with the given span ID.
     * @param spanId - The ID of the span to load into the prompt playground.
     * @returns A URL object if the project slug is available, otherwise null.
     */
    buildUrl,
  };
}

/**
 * Hook to read and clear URL query parameter for span ID.
 * Single Responsibility: Extract span ID from URL and clean up the URL.
 * @returns Object with spanId and clearSpanIdFromUrl function
 */
function useSpanIdFromUrl() {
  const searchParams = useSearchParams();
  const spanId = searchParams?.get(QUERY_PARAM_PROMPT_PLAYGROUND_SPAN_ID);
  const router = useRouter();

  /**
   * clearSpanIdFromUrl
   * Single Responsibility: Removes span ID query parameter from URL without full page reload.
   */
  const clearSpanIdFromUrl = () => {
    // Create a copy of router.query without the span ID param
    const { [QUERY_PARAM_PROMPT_PLAYGROUND_SPAN_ID]: _, ...query } =
      router.query;
    void router.replace({ pathname: router.pathname, query }, undefined, {
      shallow: true,
    });
  };

  return { spanId, clearSpanIdFromUrl };
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
  projectId,
  trpc,
}: {
  promptHandle: string;
  promptVersionNumber: number;
  projectId: string;
  trpc: ReturnType<typeof api.useContext>;
}): Promise<{ formValues: PromptConfigFormValues; versionNumber: number } | null> {
  try {
    const prompt = await trpc.prompts.getByIdOrHandle.fetch({
      idOrHandle: promptHandle,
      projectId,
      version: promptVersionNumber,
    });

    if (!prompt) {
      toaster.create({
        title: "Prompt not found",
        description: `The prompt "${promptHandle}" was not found in this project. Opening from trace data instead.`,
        meta: { closable: true },
      });
      return null;
    }

    const formValues = computeInitialFormValuesForPrompt({
      prompt,
      useSystemMessage: true,
    });

    // If the requested version differs from what was returned, the version was not found
    if (prompt.version !== promptVersionNumber) {
      toaster.create({
        title: "Version not found",
        description: `Version ${promptVersionNumber} of "${promptHandle}" was not found. Opened latest version (${prompt.version}) instead.`,
        meta: { closable: true },
      });
    }

    return { formValues, versionNumber: prompt.version };
  } catch {
    toaster.create({
      title: "Prompt not found",
      description: `Could not load prompt "${promptHandle}". Opening from trace data instead.`,
      meta: { closable: true },
    });
    return null;
  }
}

/**
 * Hook to load span data from a trace into the prompt studio.
 * When the span references a LangWatch-managed prompt (via promptHandle),
 * opens the existing prompt at the recorded version. Otherwise, creates
 * a new tab from the trace data.
 */
export function useLoadSpanIntoPromptPlayground() {
  const loadedRef = useRef(false);
  const { project } = useOrganizationTeamProject();
  const { spanId, clearSpanIdFromUrl } = useSpanIdFromUrl();
  const trpc = api.useContext();
  const { addTab } = useDraggableTabsBrowserStore(({ addTab }) => ({ addTab }));

  useEffect(() => {
    if (!spanId || loadedRef.current || !project?.id) return;

    clearSpanIdFromUrl();

    void (async () => {
      try {
        const spanData = await trpc.spans.getForPromptStudio.fetch({
          projectId: project.id,
          spanId: spanId,
        });

        if (!spanData) return;

        // When span references a managed prompt, open the existing prompt
        if (spanData.promptHandle && spanData.promptVersionNumber) {
          const existingPrompt = await tryOpenExistingPromptTab({
            promptHandle: spanData.promptHandle,
            promptVersionNumber: spanData.promptVersionNumber,
            projectId: project.id,
            trpc,
          });

          if (existingPrompt) {
            addTab({
              data: TabDataSchema.parse({
                form: {
                  currentValues: existingPrompt.formValues,
                },
                chat: {
                  initialMessagesFromSpanData: [],
                },
                meta: {
                  title: existingPrompt.formValues.handle ?? null,
                  versionNumber: existingPrompt.versionNumber,
                },
              }),
            });
            return;
          }
        }

        // Fall back: create new tab from trace data
        const defaultValues = createDefaultPromptFormValues(spanData);
        const chatMessages = addIdToMessages(
          spanData.messages,
          spanData.traceId,
        );

        addTab({
          data: TabDataSchema.parse({
            form: {
              currentValues: defaultValues,
            },
            chat: {
              initialMessagesFromSpanData: chatMessages,
            },
          }),
        });
      } catch (error) {
        logger.error({ error }, "Error loading span data into prompt studio");
        toaster.create({
          title: "Error loading span data into prompt studio",
          description: (error as Error).message,
          meta: {
            closable: true,
          },
        });
      }
    })();

    loadedRef.current = true;
  }, [
    spanId,
    project?.id,
    trpc.spans.getForPromptStudio,
    clearSpanIdFromUrl,
    addTab,
  ]);
}
