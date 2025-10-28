import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRouter } from "next/router";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useDraggableTabsBrowserStore } from "../prompt-studio-store/DraggableTabsBrowserStore";
import type { ChatMessage } from "~/server/tracer/types";
import type { PromptConfigFormValues } from "~/prompt-configs/types";
import { DEFAULT_MODEL } from "~/utils/constants";

const QUERY_PARAM_PROMPT_PLAYGROUND_SPAN_ID = "promptPlaygroundSpanId";

export function useGoToSpanInPlaygroundTab() {
  const router = useRouter();

  const goToSpanInPlaygroundTab = async (spanId: string) => {
    return await router.push({
      pathname: "/[project]/prompt-studio",
      query: {
        spanId,
      },
    });
  };

  return {
    goToSpanInPlaygroundTab,
  };
}

/**
 * Hook to load span data from a trace into the prompt studio.
 * Single Responsibility: Fetches span data and populates the chat + form.
 */
export function useLoadSpanIntoPromptStudio() {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const searchParams = useSearchParams();
  const promptPlaygroundSpanId = searchParams?.get(
    QUERY_PARAM_PROMPT_PLAYGROUND_SPAN_ID,
  );
  const trpc = api.useContext();
  const { addTab } = useDraggableTabsBrowserStore();

  useEffect(() => {
    console.log("useLoadSpanIntoPromptStudio", promptPlaygroundSpanId);
    if (!promptPlaygroundSpanId) return;
    void (async () => {
      const spanData = await trpc.spans.getForPromptStudio.fetch({
        projectId: project?.id ?? "",
        spanId: promptPlaygroundSpanId ?? "",
      });
      if (spanData) {
        const defaultValues: PromptConfigFormValues = {
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
              messages: [
                { role: "system", content: "You are a helpful assistant." },
              ],
            },
          },
        };

        addTab({
          data: {
            form: {
              currentValues: defaultValues,
            },
            chat: {
              initialMessages: spanData.messages.map(
                (message) =>
                  ({
                    id: spanData.traceId,
                    role: message.role,
                    content: message.content,
                  }) as ChatMessage & { id: string },
              ),
            },
          },
        });
      }
    })();
  }, [promptPlaygroundSpanId, project?.id, trpc.spans.getForPromptStudio]);
}
