/*
  This file contains the values for the OpenTelemetry semantic conventions for Gen AI,
  some of which are still in development and therefor currently considered to be
  experimental.

  👉 https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-events/
*/

/**
 * Anthropic AI system identifier
 * Used to identify Anthropic's Claude models
 */
export const VAL_GEN_AI_SYSTEM_ANTHROPIC = "anthropic";

/**
 * AWS Bedrock system identifier
 * Used to identify AWS Bedrock AI services
 */
export const VAL_GEN_AI_SYSTEM_AWS_BEDROCK = "aws.bedrock";

/**
 * Azure AI Inference system identifier
 * Used to identify Azure AI Inference services
 */
export const VAL_GEN_AI_SYSTEM_AZURE_AI_INFERENCE = "azure.ai.inference";

/**
 * Azure AI OpenAI system identifier
 * Used to identify Azure OpenAI services
 */
export const VAL_GEN_AI_SYSTEM_AZURE_AI_OPENAI = "azure.ai.openai";

/**
 * Cohere system identifier
 * Used to identify Cohere AI models
 */
export const VAL_GEN_AI_SYSTEM_COHERE = "cohere";

/**
 * DeepSeek system identifier
 * Used to identify DeepSeek AI models
 */
export const VAL_GEN_AI_SYSTEM_DEEPSEEK = "deepseek";

/**
 * GCP Gemini system identifier
 * Used to identify Google Cloud Gemini models
 */
export const VAL_GEN_AI_SYSTEM_GCP_GEMINI = "gcp.gemini";

/**
 * GCP Gen AI system identifier
 * Used to identify Google Cloud Generative AI services
 */
export const VAL_GEN_AI_SYSTEM_GCP_GEN_AI = "gcp.gen_ai";

/**
 * GCP Vertex AI system identifier
 * Used to identify Google Cloud Vertex AI services
 */
export const VAL_GEN_AI_SYSTEM_GCP_VERTEX_AI = "gcp.vertex_ai";

/**
 * Groq system identifier
 * Used to identify Groq AI models
 */
export const VAL_GEN_AI_SYSTEM_GROQ = "groq";

/**
 * IBM WatsonX AI system identifier
 * Used to identify IBM WatsonX AI services
 */
export const VAL_GEN_AI_SYSTEM_IBM_WATSONX_AI = "ibm.watsonx.ai";

/**
 * Mistral AI system identifier
 * Used to identify Mistral AI models
 */
export const VAL_GEN_AI_SYSTEM_MISTRAL_AI = "mistral_ai";

/**
 * OpenAI system identifier
 * Used to identify OpenAI models and services
 */
export const VAL_GEN_AI_SYSTEM_OPENAI = "openai";

/**
 * Perplexity system identifier
 * Used to identify Perplexity AI models
 */
export const VAL_GEN_AI_SYSTEM_PERPLEXITY = "perplexity";

/**
 * XAI system identifier
 * Used to identify XAI models and services
 */
export const VAL_GEN_AI_SYSTEM_XAI = "xai";

/**
 * Content filter finish reason
 * Used when generation stops due to content filtering
 */
export const VAL_GEN_AI_FINISH_REASON_CONTENT_FILTER = "content_filter";

/**
 * Error finish reason
 * Used when generation stops due to an error
 */
export const VAL_GEN_AI_FINISH_REASON_ERROR = "error";

/**
 * Length finish reason
 * Used when generation stops due to length limits
 */
export const VAL_GEN_AI_FINISH_REASON_LENGTH = "length";

/**
 * Stop finish reason
 * Used when generation stops due to stop tokens
 */
export const VAL_GEN_AI_FINISH_REASON_STOP = "stop";

/**
 * Tool calls finish reason
 * Used when generation stops due to tool calls
 */
export const VAL_GEN_AI_FINISH_REASON_TOOL_CALLS = "tool_calls";

/**
 * Union type of all supported GenAI system identifiers
 * Used for type safety when working with system identification
 */
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

/**
 * Union type of all supported GenAI finish reasons
 * Used for type safety when working with generation completion reasons
 */
export type VAL_GEN_AI_FINISH_REASONS =
  | typeof VAL_GEN_AI_FINISH_REASON_CONTENT_FILTER
  | typeof VAL_GEN_AI_FINISH_REASON_ERROR
  | typeof VAL_GEN_AI_FINISH_REASON_LENGTH
  | typeof VAL_GEN_AI_FINISH_REASON_STOP
  | typeof VAL_GEN_AI_FINISH_REASON_TOOL_CALLS;
