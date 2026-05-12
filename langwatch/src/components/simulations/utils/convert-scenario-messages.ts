import {
  ActionExecutionMessage,
  ImageMessage,
  type Message,
  type MessageRole,
  ResultMessage,
  Role,
  TextMessage,
} from "@copilotkit/runtime-client-gql";
import type { ScenarioMessageSnapshotEvent } from "~/server/scenarios/scenario-event.types";
import { safeJsonParseOrStringFallback } from "./safe-json-parse-or-string-fallback";

/**
 * Converts scenario messages to CopilotKit messages with proper ordering
 */
export function convertScenarioMessagesToCopilotKit(
  messages: ScenarioMessageSnapshotEvent["messages"],
): (Message & { traceId?: string })[] {
  const convertedMessages: (Message & { traceId?: string })[] = [];

  messages.forEach((message) => {
    if ([Role.User, Role.Assistant].includes(message.role as MessageRole)) {
      // Handle tool calls first (they should come before the response)
      const toolCalls = extractToolCalls(message);
      convertedMessages.push(...toolCalls);

      // Then handle content
      const contentMessages = convertMessageContent(message);
      convertedMessages.push(...contentMessages);
    } else if (message.role === Role.Tool) {
      convertedMessages.push(createToolResultMessage(message));
    }
  });

  // We only want the last message with a given trace id to show it,
  // So we reverse the array and then remove duplicates in order
  // and then reverse it again.
  const seenTraceIds = new Set<string>();
  return convertedMessages
    .toReversed()
    .map((message) => {
      if (!message.traceId) return message;
      if (seenTraceIds.has(message.traceId)) {
        message.traceId = undefined;
      }
      seenTraceIds.add(message.traceId!);
      return message;
    })
    .toReversed();
}

/**
 * Extracts tool calls from a message
 */
function extractToolCalls(
  message: ScenarioMessageSnapshotEvent["messages"][0],
): (ActionExecutionMessage & { traceId?: string })[] {
  if (!("toolCalls" in message) || !message.toolCalls) {
    return [];
  }

  return message.toolCalls.map((toolCall) => {
    const actionExecutionMessage: ActionExecutionMessage & {
      traceId?: string;
    } = new ActionExecutionMessage({
      id: `${message.id}-tool-${toolCall.function?.name}`,
      name: toolCall.function?.name,
      arguments: safeJsonParseOrStringFallback(
        toolCall.function?.arguments ?? "{}",
      ),
    });

    actionExecutionMessage.traceId = message.trace_id;

    return actionExecutionMessage;
  });
}

/**
 * Converts message content to appropriate message types
 */
function convertMessageContent(
  message: ScenarioMessageSnapshotEvent["messages"][0],
): (Message & { traceId?: string })[] {
  const content =
    typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content ?? {});
  const parsedContent = safeJsonParseOrStringFallback(content);

  if (Array.isArray(parsedContent)) {
    return convertMixedContent(parsedContent, message);
  }

  // Handle simple text content
  if (message.content && message.content !== "None") {
    const textMessage: TextMessage & { traceId?: string } = new TextMessage({
      id: message.id,
      role: message.role as MessageRole,
      content: content,
    });
    textMessage.traceId = message.trace_id;
    return [textMessage];
  }

  return [];
}

/**
 * Converts mixed content array (text + images) to message objects
 */
function convertMixedContent(
  content: any[],
  originalMessage: ScenarioMessageSnapshotEvent["messages"][0],
): Message[] {
  const messages: Message[] = [];

  content.forEach((item, index) => {
    if (typeof item === "object" && item.type === "text") {
      const textMessage: TextMessage & { traceId?: string } = new TextMessage({
        id: `${originalMessage.id}-content-${index}`,
        role: originalMessage.role as MessageRole,
        content: item.text,
      });
      textMessage.traceId = originalMessage.trace_id;
      messages.push(textMessage);
    } else if (typeof item === "object" && item.image) {
      const imageMessage = createImageMessage(
        item.image,
        originalMessage,
        index,
      );

      if (imageMessage) {
        messages.push(imageMessage);
      }

      // Anthropic tool use
    } else if (item.type === "tool_use") {
      const actionExecutionMessage: ActionExecutionMessage & {
        traceId?: string;
      } = new ActionExecutionMessage({
        name: item.name,
        arguments: item.arguments ?? item.input,
      });
      actionExecutionMessage.traceId = originalMessage.trace_id;
      messages.push(actionExecutionMessage);
    } else if (item.type === "tool_result") {
      const resultMessage: ResultMessage & { traceId?: string } =
        new ResultMessage({
          actionExecutionId: item.tool_use_id,
          actionName: item.name ?? "tool_result",
          result: item.content,
        });
      resultMessage.traceId = originalMessage.trace_id;
      messages.push(resultMessage);
    }
  });

  return messages;
}

/**
 * Creates an ImageMessage from a data URL
 */
function createImageMessage(
  imageData: string,
  originalMessage: ScenarioMessageSnapshotEvent["messages"][0],
  index: number,
): ImageMessage | null {
  const dataUrlMatch = imageData.match(/^data:image\/([^;]+);base64,(.+)$/);

  if (!dataUrlMatch) {
    console.warn("Invalid image data URL format:", imageData);
    return null;
  }

  const [, format, base64Data] = dataUrlMatch;

  if (!format || !base64Data) {
    console.warn("Invalid image data URL format:", imageData);
    return null;
  }

  return new ImageMessage({
    id: `${originalMessage.id}-image-${index}`,
    role: originalMessage.role as MessageRole,
    format: format as any,
    bytes: base64Data,
  });
}

/**
 * Creates a tool result message
 */
function createToolResultMessage(
  message: ScenarioMessageSnapshotEvent["messages"][0],
): ResultMessage & { traceId?: string } {
  const resultMessage: ResultMessage & { traceId?: string } = new ResultMessage(
    {
      id: message.id,
      actionExecutionId: message.id ?? "",
      actionName: "tool",
      result: safeJsonParseOrStringFallback(
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content ?? {}),
      ),
    },
  );
  resultMessage.traceId = message.trace_id;
  return resultMessage;
}
