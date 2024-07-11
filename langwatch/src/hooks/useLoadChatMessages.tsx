import { api } from "~/utils/api";
import React from "react";
import type { Message } from "ai";

// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace useLoadChatMessagesEffect {
  export interface Props {
    /**
     * Id of a span which contains chat messages. The span id is needed to
     * filter out the right span from the list of spans.
     */
    spanId?: string;
    /**
     * Id of a trace to load. (API allows to load only trace with list of all
     * spans)
     */
    traceId?: string;
    /**
     * Id of a project to load the trace from.
     */
    projectId?: string;
    /**
     * The list of chat window ids let us know what chat windows to update with
     * the chat messages. (The chat window ids array MUST be memoized in the parent
     * to prevent infinite loop in this hook)
     */
    chatWindowIds?: string[];
    /**
     * A callback to update the chat messages in the correct chat window upon
     * them being loaded. This hook takes care of calling this handler on the
     * right time.
     *
     * The property MUST be memoized in the parent to prevent infinite loop in
     * this hook.
     *
     * @param windowId - The id of the chat window to update.
     * @param messages - The list of chat messages to set in the chat window.
     */
    onSetMessages: (windowId: string, messages: Message[]) => void;
    /**
     * Update the system prompt in the chat window.
     *
     * The property MUST be memoized in the parent to prevent infinite loop in
     * this hook.
     *
     * @param windowId - The id of the chat window to update.
     * @param systemPrompt - The system prompt to set in the chat window.
     */
    onChangeSystemPrompt: (windowId: string, systemPrompt: string) => void;
  }
  /**
   * The hook is basically higher order effect and does not return anything.
   */
  export type Return = void;
}
/**
 * Load chat messages from the span object into the chat windows.
 *
 * @param param0
 */
export function useLoadChatMessagesEffect({
  spanId = "",
  projectId = "",
  traceId = "",
  chatWindowIds = [],
  onSetMessages,
  onChangeSystemPrompt,
}: useLoadChatMessagesEffect.Props): useLoadChatMessagesEffect.Return {
  const spans = api.spans.getAllForTrace.useQuery(
    { projectId, traceId },
    {
      enabled: !!projectId && !!traceId && !!spanId,
      refetchOnWindowFocus: false,
      trpc: { abortOnUnmount: true },
    }
  );

  const spanObj = spanId
    ? spans.data?.find(
        (currSpan) =>
          currSpan.span_id === spanId &&
          currSpan.type === "llm" &&
          currSpan.input?.type === "chat_messages"
      )
    : spans.data?.[0];

  React.useEffect(() => {
    if (spanObj) {
      const inputMessages = spanObj?.input
        ? JSON.parse(spanObj.input.value)
        : [];
      const outputMessages = spanObj?.output
        ? JSON.parse(spanObj.output.value)
        : [];
      const inputMessagesArr = Array.isArray(inputMessages)
        ? inputMessages
        : [inputMessages];
      const outputMessagesArr = Array.isArray(outputMessages)
        ? outputMessages
        : [outputMessages];

      const messages = [...inputMessagesArr, ...outputMessagesArr];

      // There should be only one System message in the list of messages
      const systemMessage = messages.find((m) => m.role === "system");
      const nonSystemMessages = messages.filter((m) => m.role !== "system");

      for (const chatWindowId of chatWindowIds) {
        console.log(nonSystemMessages);
        onSetMessages(chatWindowId, nonSystemMessages);
        if (systemMessage) {
          onChangeSystemPrompt(chatWindowId, systemMessage.content);
        }
      }
    }
    // chatWindowIds is not memoized in the parent and would cause an infinite loop
    // because each render returns new instance of an array with the same values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    spanObj,
    spanObj?.span_id,
    onSetMessages,
    onChangeSystemPrompt,
    chatWindowIds,
  ]);
}
