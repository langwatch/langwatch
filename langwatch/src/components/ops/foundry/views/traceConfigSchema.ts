import { SPAN_TYPES, INPUT_OUTPUT_TYPES } from "../types";

/** JSON Schema for TraceConfig — used by Monaco for intellisense + validation. */
export const traceConfigJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object" as const,
  required: ["id", "name", "resourceAttributes", "metadata", "spans"],
  properties: {
    id: { type: "string", description: "Unique trace identifier" },
    name: { type: "string", description: "Human-readable trace name" },
    description: { type: "string", description: "Optional trace description" },
    resourceAttributes: {
      type: "object",
      additionalProperties: { type: "string" },
      description: "OTel resource attributes (e.g. service.name)",
    },
    metadata: {
      type: "object",
      properties: {
        userId: { type: "string", description: "User ID for the trace" },
        threadId: { type: "string", description: "Conversation thread ID" },
        customerId: { type: "string", description: "Customer/tenant ID" },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Trace labels",
        },
      },
      additionalProperties: false,
    },
    spans: {
      type: "array",
      items: { $ref: "#/definitions/SpanConfig" },
      description: "Root-level spans in the trace",
    },
  },
  additionalProperties: false,
  definitions: {
    SpanConfig: {
      type: "object",
      required: ["id", "name", "type", "durationMs", "offsetMs", "status", "children", "attributes"],
      properties: {
        id: { type: "string" },
        name: { type: "string", description: "Span display name" },
        type: {
          type: "string",
          enum: [...SPAN_TYPES],
          description: "Span type (llm, agent, tool, rag, etc.)",
        },
        durationMs: { type: "number", minimum: 0, description: "Span duration in ms" },
        offsetMs: { type: "number", minimum: 0, description: "Offset from parent start in ms" },
        status: { type: "string", enum: ["ok", "error", "unset"] },
        children: {
          type: "array",
          items: { $ref: "#/definitions/SpanConfig" },
          description: "Child spans",
        },
        input: { $ref: "#/definitions/SpanInputOutput" },
        output: { $ref: "#/definitions/SpanInputOutput" },
        attributes: {
          type: "object",
          additionalProperties: {
            oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
          },
          description: "Custom span attributes",
        },
        exception: {
          type: "object",
          properties: {
            message: { type: "string" },
            stackTrace: { type: "string" },
          },
          required: ["message"],
        },
        llm: { $ref: "#/definitions/LLMConfig" },
        rag: { $ref: "#/definitions/RAGConfig" },
        prompt: { $ref: "#/definitions/PromptConfig" },
      },
      additionalProperties: false,
    },
    SpanInputOutput: {
      type: "object",
      required: ["type", "value"],
      properties: {
        type: { type: "string", enum: [...INPUT_OUTPUT_TYPES] },
        value: { description: "The input/output value" },
      },
    },
    LLMConfig: {
      type: "object",
      properties: {
        requestModel: { type: "string", description: "Model requested (e.g. gpt-4o)" },
        responseModel: { type: "string", description: "Model that responded" },
        messages: {
          type: "array",
          items: {
            type: "object",
            required: ["role", "content"],
            properties: {
              role: { type: "string", enum: ["system", "user", "assistant", "tool"] },
              content: { type: "string" },
            },
          },
        },
        temperature: { type: "number", minimum: 0, maximum: 2 },
        stream: { type: "boolean" },
        metrics: {
          type: "object",
          properties: {
            promptTokens: { type: "number" },
            completionTokens: { type: "number" },
            cost: { type: "number" },
          },
        },
      },
      additionalProperties: false,
    },
    RAGConfig: {
      type: "object",
      required: ["contexts"],
      properties: {
        contexts: {
          type: "array",
          items: {
            type: "object",
            required: ["document_id", "chunk_id", "content"],
            properties: {
              document_id: { type: "string" },
              chunk_id: { type: "string" },
              content: { type: "string" },
            },
          },
        },
      },
      additionalProperties: false,
    },
    PromptConfig: {
      type: "object",
      properties: {
        promptId: { type: "string" },
        versionId: { type: "string" },
        variables: {
          type: "object",
          additionalProperties: { type: "string" },
        },
      },
      additionalProperties: false,
    },
  },
};
