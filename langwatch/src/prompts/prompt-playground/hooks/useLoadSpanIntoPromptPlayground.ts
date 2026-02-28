import { useSearchParams } from "next/navigation";
import { useRouter } from "next/router";
import { useEffect, useRef } from "react";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { formSchema } from "~/prompts/schemas";
import type { PromptConfigFormValues } from "~/prompts/types";
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
 * Creates default form values for a new prompt config.
 * Single Responsibility: Generate initial prompt configuration structure from span data.
 * @param spanData - The span data containing LLM configuration
 * @returns Initial form values for a new prompt
 */
function createDefaultPromptFormValues(
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

  return formSchema.parse({
    handle: null,
    scope: "PROJECT",
    version: {
      configData: {
        prompt: systemPrompt,
        llm: {
          // The model should always be available here, but we fall back to the default model if it's not.
          model: spanData.llmConfig.model ?? DEFAULT_MODEL,
          temperature: spanData.llmConfig.temperature ?? undefined,
          maxTokens: spanData.llmConfig.maxTokens ?? undefined,
        },
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
 * Hook to load span data from a trace into the prompt studio.
 * Single Responsibility: Orchestrate fetching span data and creating a new tab.
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

        if (spanData) {
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
        }
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
