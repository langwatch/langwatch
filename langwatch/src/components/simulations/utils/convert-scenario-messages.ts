import {
  TextMessage,
  Role,
  type MessageRole,
  type Message,
  ActionExecutionMessage,
  ResultMessage,
  ImageMessage,
} from "@copilotkit/runtime-client-gql";
import type { ScenarioMessageSnapshotEvent } from "~/app/api/scenario-events/[[...route]]/types";
import { safeJsonParseOrStringFallback } from "./safe-json-parse-or-string-fallback";

/**
 * Converts scenario messages to CopilotKit messages with proper ordering
 */
export function convertScenarioMessagesToCopilotKit(
  messages: ScenarioMessageSnapshotEvent["messages"]
): Message[] {
  const convertedMessages: Message[] = [];

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

  return convertedMessages;
}

/**
 * Extracts tool calls from a message
 */
function extractToolCalls(
  message: ScenarioMessageSnapshotEvent["messages"][0]
): ActionExecutionMessage[] {
  if (!("toolCalls" in message) || !message.toolCalls) {
    return [];
  }

  return message.toolCalls.map(
    (toolCall) =>
      new ActionExecutionMessage({
        id: `${message.id}-tool-${toolCall.function?.name}`,
        name: toolCall.function?.name,
        arguments: safeJsonParseOrStringFallback(
          toolCall.function?.arguments ?? "{}"
        ),
      })
  );
}

/**
 * Converts message content to appropriate message types
 */
function convertMessageContent(
  message: ScenarioMessageSnapshotEvent["messages"][0]
): Message[] {
  const parsedContent = safeJsonParseOrStringFallback(message.content ?? "");

  if (Array.isArray(parsedContent)) {
    return convertMixedContent(parsedContent, message);
  }

  // Handle simple text content
  if (message.content && message.content !== "None") {
    return [
      new TextMessage({
        id: message.id,
        role: message.role as MessageRole,
        content: message.content,
      }),
    ];
  }

  return [];
}

/**
 * Converts mixed content array (text + images) to message objects
 */
function convertMixedContent(
  content: any[],
  originalMessage: ScenarioMessageSnapshotEvent["messages"][0]
): Message[] {
  const messages: Message[] = [];

  content.forEach((item, index) => {
    if (typeof item === "object" && item.type === "text") {
      messages.push(
        new TextMessage({
          id: `${originalMessage.id}-content-${index}`,
          role: originalMessage.role as MessageRole,
          content: item.text,
        })
      );
    } else if (typeof item === "object" && item.image) {
      const imageMessage = createImageMessage(
        item.image,
        originalMessage,
        index
      );
      if (imageMessage) {
        messages.push(imageMessage);
      }
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
  index: number
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
  message: ScenarioMessageSnapshotEvent["messages"][0]
): ResultMessage {
  return new ResultMessage({
    id: message.id,
    actionExecutionId: message.id,
    actionName: "tool",
    result: safeJsonParseOrStringFallback(message.content ?? "{}"),
  });
}
