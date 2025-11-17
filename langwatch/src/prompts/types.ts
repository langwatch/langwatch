import { type z } from "zod";

import { type formSchema } from "./schemas";

/**
 * Represents a code snippet for API usage
 */
export type Snippet = {
  /** The actual code content of the snippet */
  content: string;
  /** The programming language/framework target of the snippet */
  target: Target;
  /** Human-readable title for the snippet */
  title: string;
  /** Human-readable description for the snippet */
  path?: string;
  /** The HTTP method for the snippet */
  method?: string;
};

/**
 * List of all available programming language/framework targets supported by OpenAPISnippet
 */
const AVAILABLE_TARGETS = [
  "c_libcurl",
  "csharp_restsharp",
  "csharp_httpclient",
  "go_native",
  "java_okhttp",
  "java_unirest",
  "javascript_jquery",
  "javascript_xhr",
  "node_native",
  "node_request",
  "node_unirest",
  "objc_nsurlsession",
  "ocaml_cohttp",
  "php_curl",
  "php_http1",
  "php_http2",
  "python_python3",
  "python_requests",
  "ruby_native",
  "shell_curl",
  "shell_httpie",
  "shell_wget",
  "swift_nsurlsession",
] as const;

export type Target = (typeof AVAILABLE_TARGETS)[number];

/**
 * Form values for prompt configuration management, inferred from formSchema.
 *
 * Represents the complete shape of a prompt config form including:
 * - handle, scope, and version metadata
 * - prompt/messages content
 * - inputs/outputs definitions
 * - LLM settings (model, temperature, max_tokens, litellm_params)
 * - demonstrations and prompting_technique
 *
 * Used throughout the prompt-configs module for form handling, validation,
 * and state management in usePromptConfigForm, PromptConfigForm, and related components.
 *
 * @see formSchema - Source schema definition
 */
export type PromptConfigFormValues = z.infer<typeof formSchema>;
