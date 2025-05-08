import { api } from "~/utils/api";
import React from "react";
import type { Message } from "ai";

// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace useLoadChatMessagesEffect {
  export interface Props {
    spanId?: string;
    traceId?: string;
    projectId?: string;
    chatWindowIds?: string[];
    onSetMessages: (windowId: string, messages: Message[]) => void;
    onChangeSystemPrompt: (windowId: string, systemPrompt: string) => void;
  }
  export type Return = void;
}

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
      const input = spanObj.input;
      const output = spanObj.output;

      const inputMessages: Message[] = [];
      const outputMessages: Message[] = [];

      if (input) {
        if (typeof input === "string") {
          inputMessages.push(...JSON.parse(input));
        } else if (Array.isArray(input)) {
          inputMessages.push(...input);
        } else {
          inputMessages.push(input as unknown as Message);
        }
      }
      if (output) {
        if (typeof output === "string") {
          outputMessages.push(...JSON.parse(output));
        } else if (Array.isArray(output)) {
          outputMessages.push(...output);
        } else {
          outputMessages.push(output as unknown as Message);
        }
      }

      const inputMessagesArr = (
        Array.isArray(inputMessages) ? inputMessages : [inputMessages]
      ).map((message) =>
        message.role ? message : { id: void 0, role: "user", content: message.toString() }
      );
      const outputMessagesArr = (
        Array.isArray(outputMessages) ? outputMessages : [outputMessages]
      ).map((message) =>
        message.role
          ? message
          : { id: void 0, role: "assistant", content: message.toString() }
      );

      // Generate message id placeholders in case they are missing
      // because the MessageBlock component uses the id to determine
      // keys in lists.
      const messages = [...inputMessagesArr, ...outputMessagesArr].map(
        (message, ix) => {
          return { ...message, id: message.id || `${spanObj?.span_id}_${ix}` };
        }
      );

      const systemMessage = messages.find((m) => m.role === "system");
      const nonSystemMessages = messages.filter((m) => m.role !== "system");

      for (const chatWindowId of chatWindowIds) {
        onSetMessages(chatWindowId, nonSystemMessages as Message[]);
        if (systemMessage) {
          onChangeSystemPrompt(chatWindowId, systemMessage.content);
        }
      }
    }
  }, [
    spanObj,
    spanObj?.span_id,
    onSetMessages,
    onChangeSystemPrompt,
    chatWindowIds,
  ]);
}
