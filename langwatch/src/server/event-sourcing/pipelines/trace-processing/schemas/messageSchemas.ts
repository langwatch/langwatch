import { z } from "zod";
import { match, P } from "ts-pattern";

/**
 * OpenTelemetry GenAI semantic conventions message format (target format)
 * Based on: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
 */

// Rich content types for OpenTelemetry GenAI format
const GenAITextContent = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const GenAIImageContent = z.object({
  type: z.literal("image_url"),
  image_url: z.object({
    url: z.string(),
    detail: z.enum(["auto", "low", "high"]).optional(),
  }),
});

const GenAIToolCallContent = z.object({
  type: z.literal("tool_call"),
  toolName: z.string().optional(),
  toolCallId: z.string().optional(),
  args: z.string().optional(),
});

const GenAIToolResultContent = z.object({
  type: z.literal("tool_result"),
  toolName: z.string().optional(),
  toolCallId: z.string().optional(),
  result: z.unknown().optional(),
});

const GenAIRichContent = z.union([
  GenAITextContent,
  GenAIImageContent,
  GenAIToolCallContent,
  GenAIToolResultContent,
]);

export type GenAIRichContent = z.infer<typeof GenAIRichContent>;

const GenAIFunctionCall = z.object({
  name: z.string().optional(),
  arguments: z.string().optional(),
});

const GenAIToolCall = z.object({
  id: z.string(),
  type: z.string(),
  function: GenAIFunctionCall,
});

export const OpenTelemetryGenAIMessage = z
  .object({
    role: z
      .enum(["system", "user", "assistant", "function", "tool", "unknown"])
      .optional(),
    content: z
      .union([z.string(), z.array(GenAIRichContent), z.null()])
      .optional(),
    function_call: GenAIFunctionCall.nullable().optional(),
    tool_calls: z.array(GenAIToolCall).nullable().optional(),
    tool_call_id: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
  })
  .refine((data) => data.role !== undefined || data.content !== undefined, {
    message: "At least one of 'role' or 'content' must be present",
  });

export type OpenTelemetryGenAIMessage = z.infer<
  typeof OpenTelemetryGenAIMessage
>;

/**
 * LangWatch format (current ChatMessage from types.ts)
 * Compatible with OpenTelemetry GenAI format
 */
export const LangWatchMessage = OpenTelemetryGenAIMessage;
export type LangWatchMessage = OpenTelemetryGenAIMessage;

/**
 * OpenAI message format
 * Mostly compatible with OpenTelemetry GenAI, but may have slight variations
 */
export const OpenAIMessage = z.object({
  role: z.enum(["system", "user", "assistant", "function", "tool"]),
  content: z
    .union([
      z.string(),
      z.array(
        z.union([
          z.object({ type: z.literal("text"), text: z.string() }),
          z.object({
            type: z.literal("image_url"),
            image_url: z.union([
              z.string(),
              z.object({
                url: z.string(),
                detail: z.enum(["auto", "low", "high"]).optional(),
              }),
            ]),
          }),
        ])
      ),
      z.null(),
    ])
    .optional(),
  name: z.string().optional(),
  function_call: z
    .object({
      name: z.string(),
      arguments: z.string(),
    })
    .optional(),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        type: z.literal("function"),
        function: z.object({
          name: z.string(),
          arguments: z.string(),
        }),
      })
    )
    .optional(),
  tool_call_id: z.string().optional(),
});

export type OpenAIMessage = z.infer<typeof OpenAIMessage>;

/**
 * Anthropic (Claude) message format
 * Uses content blocks instead of simple strings
 */
const AnthropicTextBlock = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const AnthropicImageBlock = z.object({
  type: z.literal("image"),
  source: z.object({
    type: z.literal("base64"),
    media_type: z.string(),
    data: z.string(),
  }),
});

const AnthropicToolUseBlock = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.unknown()),
});

const AnthropicToolResultBlock = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  content: z.union([z.string(), z.array(AnthropicTextBlock)]).optional(),
  is_error: z.boolean().optional(),
});

const AnthropicContentBlock = z.union([
  AnthropicTextBlock,
  AnthropicImageBlock,
  AnthropicToolUseBlock,
  AnthropicToolResultBlock,
]);

export type AnthropicContentBlock = z.infer<typeof AnthropicContentBlock>;
export type AnthropicTextBlock = z.infer<typeof AnthropicTextBlock>;

export const AnthropicMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.union([z.string(), z.array(AnthropicContentBlock)]),
});

export type AnthropicMessage = z.infer<typeof AnthropicMessage>;

/**
 * Google (Gemini) message format
 * Uses "parts" array instead of content
 */
const GeminiTextPart = z.object({
  text: z.string(),
});

const GeminiInlineDataPart = z.object({
  inline_data: z.object({
    mime_type: z.string(),
    data: z.string(),
  }),
});

const GeminiFunctionCallPart = z.object({
  function_call: z.object({
    name: z.string(),
    args: z.record(z.unknown()).optional(),
  }),
});

const GeminiFunctionResponsePart = z.object({
  function_response: z.object({
    name: z.string(),
    response: z.record(z.unknown()),
  }),
});

const GeminiPart = z.union([
  GeminiTextPart,
  GeminiInlineDataPart,
  GeminiFunctionCallPart,
  GeminiFunctionResponsePart,
]);

export type GeminiPart = z.infer<typeof GeminiPart>;

export const GeminiMessage = z.object({
  role: z.enum(["user", "model", "function"]),
  parts: z.array(GeminiPart),
});

export type GeminiMessage = z.infer<typeof GeminiMessage>;

/**
 * Cohere message format
 */
export const CohereMessage = z.object({
  role: z.enum(["USER", "CHATBOT", "SYSTEM", "TOOL"]),
  message: z.string().optional(),
  text: z.string().optional(),
  tool_calls: z
    .array(
      z.object({
        name: z.string(),
        parameters: z.record(z.unknown()),
      })
    )
    .optional(),
  tool_results: z
    .array(
      z.object({
        call: z.object({
          name: z.string(),
          parameters: z.record(z.unknown()),
        }),
        outputs: z.array(z.record(z.unknown())),
      })
    )
    .optional(),
});

export type CohereMessage = z.infer<typeof CohereMessage>;

/**
 * AWS Bedrock message formats (supports multiple models)
 * Claude format via Bedrock
 */
export const BedrockClaudeMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.union([
    z.string(),
    z.array(
      z.union([
        z.object({ type: z.literal("text"), text: z.string() }),
        z.object({
          type: z.literal("image"),
          source: z.object({
            type: z.literal("base64"),
            media_type: z.string(),
            data: z.string(),
          }),
        }),
      ])
    ),
  ]),
});

export type BedrockClaudeMessage = z.infer<typeof BedrockClaudeMessage>;

/**
 * Progressive fallback schema - tries each format in order
 * More specific formats are checked first to avoid false matches
 * and prevent data loss from premature OpenTelemetry matching
 */
export const AnyProviderMessage = z.union([
  GeminiMessage, // Most specific: has "parts" field
  CohereMessage, // Specific: uppercase roles, "message"/"text" fields
  AnthropicMessage, // Specific: content blocks with specific structure
  BedrockClaudeMessage, // Similar to Anthropic but distinct
  OpenAIMessage, // Requires role, more specific than OTEL
  OpenTelemetryGenAIMessage, // Most permissive, checked last
  LangWatchMessage, // Same as OpenTelemetryGenAIMessage, redundant but kept for compatibility
]);

export type AnyProviderMessage = z.infer<typeof AnyProviderMessage>;

/**
 * Array of messages in any supported format
 */
export const AnyProviderMessages = z.array(AnyProviderMessage);
export type AnyProviderMessages = z.infer<typeof AnyProviderMessages>;

/**
 * Helper to detect message format
 */
export enum MessageFormat {
  OpenTelemetryGenAI = "opentelemetry_genai",
  LangWatch = "langwatch",
  OpenAI = "openai",
  Anthropic = "anthropic",
  Gemini = "gemini",
  Cohere = "cohere",
  BedrockClaude = "bedrock_claude",
  Unknown = "unknown",
}

/**
 * Checks if a message has Gemini format (contains "parts" field)
 */
const isGeminiFormat = (msg: Record<string, unknown>): boolean =>
  "parts" in msg && Array.isArray(msg.parts);

/**
 * Checks if a message has Cohere format (uppercase role)
 */
const isCohereFormat = (msg: Record<string, unknown>): boolean =>
  "role" in msg &&
  typeof msg.role === "string" &&
  msg.role === msg.role.toUpperCase();

/**
 * Anthropic-specific block types that distinguish it from OpenAI
 */
const ANTHROPIC_BLOCK_TYPES = ["image", "tool_use", "tool_result"] as const;

/**
 * Checks if a message has Anthropic-specific content blocks
 */
const hasAnthropicContentBlocks = (msg: Record<string, unknown>): boolean => {
  if (!("content" in msg) || !Array.isArray(msg.content)) {
    return false;
  }

  return msg.content.some(
    (block: unknown) =>
      typeof block === "object" &&
      block !== null &&
      "type" in block &&
      ANTHROPIC_BLOCK_TYPES.includes(
        (block as { type: string })
          .type as (typeof ANTHROPIC_BLOCK_TYPES)[number]
      )
  );
};

/**
 * Checks if a message has a role field (OpenAI/OpenTelemetry format)
 */
const hasRoleField = (msg: Record<string, unknown>): boolean => "role" in msg;

/**
 * Detects the format of a message array using pattern matching
 */
export function detectMessageFormat(messages: unknown): MessageFormat {
  // Early return for non-array or empty array
  if (!Array.isArray(messages) || messages.length === 0) {
    return MessageFormat.Unknown;
  }

  const firstMessage = messages[0];

  // Early return for invalid message structure
  if (typeof firstMessage !== "object" || firstMessage === null) {
    return MessageFormat.Unknown;
  }

  const msg = firstMessage as Record<string, unknown>;

  return match(msg)
    .when(isGeminiFormat, () => MessageFormat.Gemini)
    .when(isCohereFormat, () => MessageFormat.Cohere)
    .when(hasAnthropicContentBlocks, () => MessageFormat.Anthropic)
    .when(hasRoleField, () => MessageFormat.OpenAI)
    .otherwise(() => MessageFormat.Unknown);
}
