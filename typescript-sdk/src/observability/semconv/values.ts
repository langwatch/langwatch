/*
  This file contains the values for the OpenTelemetry semantic conventions for Gen AI,
  some of which are still in development and therefor currently considered to be
  experimental.

  👉 https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-events/
*/

export const VAL_GEN_AI_SYSTEM_ANTHROPIC = "anthropic";
export const VAL_GEN_AI_SYSTEM_AWS_BEDROCK = "aws.bedrock";
export const VAL_GEN_AI_SYSTEM_AZURE_AI_INFERENCE = "azure.ai.inference";
export const VAL_GEN_AI_SYSTEM_AZURE_AI_OPENAI = "azure.ai.openai";
export const VAL_GEN_AI_SYSTEM_COHERE = "cohere";
export const VAL_GEN_AI_SYSTEM_DEEPSEEK = "deepseek";
export const VAL_GEN_AI_SYSTEM_GCP_GEMINI = "gcp.gemini";
export const VAL_GEN_AI_SYSTEM_GCP_GEN_AI = "gcp.gen_ai";
export const VAL_GEN_AI_SYSTEM_GCP_VERTEX_AI = "gcp.vertex_ai";
export const VAL_GEN_AI_SYSTEM_GROQ = "groq";
export const VAL_GEN_AI_SYSTEM_IBM_WATSONX_AI = "ibm.watsonx.ai";
export const VAL_GEN_AI_SYSTEM_MISTRAL_AI = "mistral_ai";
export const VAL_GEN_AI_SYSTEM_OPENAI = "openai";
export const VAL_GEN_AI_SYSTEM_PERPLEXITY = "perplexity";
export const VAL_GEN_AI_SYSTEM_XAI = "xai";

export const VAL_GEN_AI_FINISH_REASON_CONTENT_FILTER = "content_filter";
export const VAL_GEN_AI_FINISH_REASON_ERROR = "error";
export const VAL_GEN_AI_FINISH_REASON_LENGTH = "length";
export const VAL_GEN_AI_FINISH_REASON_STOP = "stop";
export const VAL_GEN_AI_FINISH_REASON_TOOL_CALLS = "tool_calls";

export type VAL_GEN_AI_SYSTEMS =
  | typeof VAL_GEN_AI_SYSTEM_ANTHROPIC
  | typeof VAL_GEN_AI_SYSTEM_AWS_BEDROCK
  | typeof VAL_GEN_AI_SYSTEM_AZURE_AI_INFERENCE
  | typeof VAL_GEN_AI_SYSTEM_AZURE_AI_OPENAI
  | typeof VAL_GEN_AI_SYSTEM_COHERE
  | typeof VAL_GEN_AI_SYSTEM_DEEPSEEK
  | typeof VAL_GEN_AI_SYSTEM_GCP_GEMINI
  | typeof VAL_GEN_AI_SYSTEM_GCP_GEN_AI
  | typeof VAL_GEN_AI_SYSTEM_GCP_VERTEX_AI
  | typeof VAL_GEN_AI_SYSTEM_GROQ
  | typeof VAL_GEN_AI_SYSTEM_IBM_WATSONX_AI
  | typeof VAL_GEN_AI_SYSTEM_MISTRAL_AI
  | typeof VAL_GEN_AI_SYSTEM_OPENAI
  | typeof VAL_GEN_AI_SYSTEM_PERPLEXITY
  | typeof VAL_GEN_AI_SYSTEM_XAI;

export type VAL_GEN_AI_FINISH_REASONS =
  | typeof VAL_GEN_AI_FINISH_REASON_CONTENT_FILTER
  | typeof VAL_GEN_AI_FINISH_REASON_ERROR
  | typeof VAL_GEN_AI_FINISH_REASON_LENGTH
  | typeof VAL_GEN_AI_FINISH_REASON_STOP
  | typeof VAL_GEN_AI_FINISH_REASON_TOOL_CALLS;
