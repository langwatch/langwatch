import { convertUint8ArrayToBase64 } from "@ai-sdk/provider-utils";
import { type CoreMessage, type ImagePart } from "ai";
import { z } from "zod";
import { type ErrorCapture } from "./internal/generated/types/tracer";
import { chatMessageSchema } from "./internal/generated/types/tracer.generated";
import { type ChatMessage, type SpanInputOutput } from "./types";

const convertImageToUrl = (
  image: ImagePart["image"],
  mimeType: string | undefined
) => {
  try {
    return image instanceof URL
      ? image.toString()
      : typeof image === "string"
      ? image
      : `data:${mimeType ?? "image/jpeg"};base64,${convertUint8ArrayToBase64(
          image as any
        )}`;
  } catch (e) {
    console.error("[LangWatch] error converting vercel ui image to url:", e);
    return "";
  }
};

// Mostly copied from https://github.com/vercel/ai/blob/main/packages/openai/src/convert-to-openai-chat-messages.ts
export function convertFromVercelAIMessages(
  messages: CoreMessage[]
): ChatMessage[] {
  const lwMessages: ChatMessage[] = [];

  for (const { role, content } of messages) {
    switch (role) {
      case "system": {
        lwMessages.push({ role: "system", content });
        break;
      }

      case "user": {
        if (
          Array.isArray(content) &&
          content.length === 1 &&
          content[0]?.type === "text"
        ) {
          lwMessages.push({ role: "user", content: content[0].text });
          break;
        }

        lwMessages.push({
          role: "user",
          content: Array.isArray(content)
            ? content.map((part) => {
                switch (part.type) {
                  case "text": {
                    return { type: "text", text: part.text };
                  }
                  case "image": {
                    return {
                      type: "image_url",
                      image_url: {
                        url: convertImageToUrl(part.image, part.mimeType),
                      },
                    };
                  }
                  default: {
                    return part as any;
                  }
                }
              })
            : content,
        });

        break;
      }

      case "assistant": {
        let text = "";
        const toolCalls: Array<{
          id: string;
          type: "function";
          function: { name: string; arguments: string };
        }> = [];

        if (Array.isArray(content)) {
          for (const part of content) {
            switch (part.type) {
              case "text": {
                text += part.text;
                break;
              }
              case "tool-call": {
                toolCalls.push({
                  id: part.toolCallId,
                  type: "function",
                  function: {
                    name: part.toolName,
                    arguments: JSON.stringify(part.args),
                  },
                });
                break;
              }
              default: {
                const _exhaustiveCheck = part;
                throw new Error(`Unsupported part: ${_exhaustiveCheck as any}`);
              }
            }
          }
        } else {
          text = content;
        }

        lwMessages.push({
          role: "assistant",
          content: text,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        });

        break;
      }

      case "tool": {
        for (const toolResponse of content) {
          lwMessages.push({
            role: "tool",
            tool_call_id: toolResponse.toolCallId,
            content: JSON.stringify(toolResponse.result),
          });
        }
        break;
      }

      default: {
        const _exhaustiveCheck = role;
        throw new Error(`Unsupported role: ${_exhaustiveCheck as any}`);
      }
    }
  }

  return lwMessages;
}

export const captureError = (error: unknown): ErrorCapture => {
  if (
    error &&
    typeof error === "object" &&
    "has_error" in error &&
    "message" in error &&
    "stacktrace" in error
  ) {
    return error as ErrorCapture;
  } else if (error instanceof Error) {
    return {
      has_error: true,
      message: error.message,
      stacktrace: error.stack ? error.stack.split("\n") : [],
    };
  } else if (typeof error === "object" && error !== null) {
    const err = error as { message: unknown; stack: unknown };
    const message =
      typeof err.message === "string"
        ? err.message
        : "An unknown error occurred";
    const stacktrace =
      typeof err.stack === "string"
        ? err.stack.split("\n")
        : Array.isArray(err.stack) &&
          err.stack.length > 0 &&
          typeof err.stack[0] === "string"
        ? err.stack
        : ["No stack trace available"];
    return {
      has_error: true,
      message,
      stacktrace,
    };
  } else {
    // Handle primitives and other types that are not an error object
    return {
      has_error: true,
      message: String(error),
      stacktrace: [],
    };
  }
};

export const autoconvertTypedValues = (value: unknown): SpanInputOutput => {
  if (typeof value === "string") {
    return { type: "text", value };
  }

  const chatMessages = z.array(chatMessageSchema).safeParse(value);
  if (Array.isArray(value) && chatMessages.success) {
    return {
      type: "chat_messages",
      value: chatMessages.data,
    };
  }

  try {
    JSON.stringify(value);
    return { type: "json", value: value as object };
  } catch (e) {
    return { type: "raw", value: value as any };
  }
};
