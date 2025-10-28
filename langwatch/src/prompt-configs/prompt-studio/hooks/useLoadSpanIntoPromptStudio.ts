import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRouter } from "next/router";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { useDraggableTabsBrowserStore } from "../prompt-studio-store/DraggableTabsBrowserStore";
import type { ChatMessage } from "~/server/tracer/types";
import type { PromptConfigFormValues } from "~/prompt-configs/types";
import { DEFAULT_MODEL } from "~/utils/constants";

const QUERY_PARAM_PROMPT_PLAYGROUND_SPAN_ID = "promptPlaygroundSpanId";

/**
 * Hook for navigation to prompt studio with a span ID.
 * Single Responsibility: Navigate to prompt studio page with span query param.
 */
export function useGoToSpanInPlaygroundTab() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const goToSpanInPlaygroundTab = async (spanId: string) => {
    return await router.push({
      pathname: "/[project]/prompt-studio",
      query: {
        project: project?.slug,
        spanId,
      },
    });
  };

  return {
    goToSpanInPlaygroundTab,
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
function createDefaultPromptFormValues(): PromptConfigFormValues {
  return {
    handle: null,
    scope: "PROJECT",
    version: {
      configData: {
        prompt: "You are a helpful assistant.",
        llm: {
          model: DEFAULT_MODEL,
        },
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
        messages: [{ role: "system", content: "You are a helpful assistant." }],
      },
    },
  };
}

/**
 * Transforms span messages into chat messages format.
 * Single Responsibility: Convert span message data to chat UI format.
 */
function transformSpanMessagesToChat(
  messages: Array<{ role: string; content: string }>,
  traceId: string,
): Array<ChatMessage & { id: string }> {
  return messages.map((message) => ({
    id: traceId,
    role: message.role,
    content: message.content ?? "",
  })) as Array<ChatMessage & { id: string }>;
}

/**
 * Hook to load span data from a trace into the prompt studio.
 * Single Responsibility: Orchestrate fetching span data and creating a new tab.
 */
export function useLoadSpanIntoPromptStudio() {
  const loadedRef = useRef(false);
  const { project } = useOrganizationTeamProject();
  const { spanId, clearSpanIdFromUrl } = useSpanIdFromUrl();
  const trpc = api.useUtils();
  const { addTab } = useDraggableTabsBrowserStore();

  useEffect(() => {
    if (!spanId || loadedRef.current) return;

    console.log("loading span data into prompt studio", spanId);
    clearSpanIdFromUrl();

    void (async () => {
      const spanData = await trpc.spans.getForPromptStudio.fetch({
        projectId: project?.id ?? "",
        spanId: spanId,
      });

      if (spanData) {
        const defaultValues = createDefaultPromptFormValues();
        const chatMessages = transformSpanMessagesToChat(
          spanData.messages,
          spanData.traceId,
        );

        addTab({
          data: {
            form: {
              currentValues: defaultValues,
            },
            chat: {
              initialMessages: chatMessages,
            },
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
