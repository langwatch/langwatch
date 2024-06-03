import { convertUint8ArrayToBase64 } from "@ai-sdk/provider-utils";
import { type ImagePart, type CoreMessage } from "ai";
import { type ChatMessage } from "./types";

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
