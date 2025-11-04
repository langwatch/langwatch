import { api, type RouterOutputs } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRouter } from "next/router";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  TabDataSchema,
  useDraggableTabsBrowserStore,
} from "../prompt-studio-store/DraggableTabsBrowserStore";
import type { PromptConfigFormValues } from "~/prompt-configs/types";
import { createLogger } from "~/utils/logger";
import { toaster } from "~/components/ui/toaster";
import type { ChatMessage } from "~/server/tracer/types";
import { DEFAULT_MODEL } from "~/utils/constants";

const logger = createLogger("useLoadSpanIntoPromptStudio");

const QUERY_PARAM_PROMPT_PLAYGROUND_SPAN_ID = "promptPlaygroundSpanId";

/**
 * Hook for navigation to prompt studio with a span ID.
 * Single Responsibility: Navigate to prompt studio page with span query param.
 */
export function useGoToSpanInPlaygroundTabUrlBuilder() {
  const { project } = useOrganizationTeamProject();

  const buildUrl = (spanId: string) => {
    const url = new URL(
      `/${project?.slug}/prompt-studio`,
      window.location.origin,
    );
    url.searchParams.set(QUERY_PARAM_PROMPT_PLAYGROUND_SPAN_ID, spanId);
    return url;
  };

  return {
    buildUrl,
  };
}

/**
 * Hook to read and clear URL query parameter for span ID.
 * Single Responsibility: Extract span ID from URL and clean up the URL.
 */
function useSpanIdFromUrl() {
  const searchParams = useSearchParams();
  const spanId = searchParams?.get(QUERY_PARAM_PROMPT_PLAYGROUND_SPAN_ID);
  const router = useRouter();

  const clearSpanIdFromUrl = () => {
    console.log("clearing span id from url", spanId);
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
 * Single Responsibility: Generate initial prompt configuration structure.
 */
function createDefaultPromptFormValues(
  spanData: RouterOutputs["spans"]["getForPromptStudio"],
): PromptConfigFormValues {
  if (!spanData.llmConfig?.model) {
    logger.warn("Model is not available for span data. This is not expected.", {
      spanData,
    });
  }

  return {
    handle: null,
    scope: "PROJECT",
    version: {
      configData: {
        prompt:
          typeof spanData.llmConfig?.systemPrompt === "string"
            ? spanData.llmConfig.systemPrompt
            : JSON.stringify(spanData.llmConfig?.systemPrompt),
        llm: {
          // The model should always be available here, but we fall back to the default model if it's not.
          model: spanData.llmConfig.model ?? DEFAULT_MODEL,
          temperature: spanData.llmConfig.temperature ?? undefined,
          maxTokens: spanData.llmConfig.maxTokens,
        },
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
        messages: [{ role: "system", content: "You are a helpful assistant." }],
      },
    },
  };
}

/**
 * Adds a unique ID to each message.
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
export function useLoadSpanIntoPromptStudio() {
  const loadedRef = useRef(false);
  const { project } = useOrganizationTeamProject();
  const { spanId, clearSpanIdFromUrl } = useSpanIdFromUrl();
  const trpc = api.useContext();
  const { addTab } = useDraggableTabsBrowserStore();

  useEffect(() => {
    if (!spanId || loadedRef.current) return;

    console.log("loading span data into prompt studio", spanId);
    clearSpanIdFromUrl();

    void (async () => {
      try {
        const spanData = await trpc.spans.getForPromptStudio.fetch({
          projectId: project?.id ?? "",
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
        logger.error("Error loading span data into prompt studio", error);
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
