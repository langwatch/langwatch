import OpenAPISnippet from "openapi-snippet";
import specs from "../../../src/app/api/openapiLangWatch.json";
import { createLogger } from "~/utils/logger";
import type { Snippet } from "../types";

const logger = createLogger("generatePromptApiSnippet");

/**
 * Raw result structure returned by the OpenAPISnippet library
 */
type OpenAPISnippetResult = {
  description: string;
  method: string;
  resource: string;
  url: string;
  snippets: {
    content: string;
    id: Target;
    title: string;
  }[];
  targets: Target[];
};

/**
 * Response structure for the generateGetPromptApiSnippets function
 */
interface GenerateGetPromptApiSnippetsResponse {
  /** Description of the API endpoint */
  description: string;
  /** HTTP method (GET, POST, etc.) */
  method: string;
  /** API resource path */
  resource: string;
  /** Full URL of the endpoint */
  url: string;
  /** Array of code snippets for different languages/frameworks */
  snippets: Snippet[];
  /** Available target languages/frameworks for this endpoint */
  targets: Target[];
}

/**
 * Generates code snippets for the GET /api/prompts/{id} endpoint
 *
 * This function uses the OpenAPISnippet library to generate code examples
 * for accessing the prompt API endpoint in various programming languages.
 *
 * @param targets - Optional array of specific language targets to generate snippets for
 * @returns Object containing API information and code snippets, or null if generation fails
 */
export function generateGetPromptApiSnippets(
  targets: readonly Target[] = AVAILABLE_TARGETS
): GenerateGetPromptApiSnippetsResponse | null {
  try {
    const result: OpenAPISnippetResult = OpenAPISnippet.getEndpointSnippets(
      specs,
      "/api/prompts/{id}",
      "get",
      targets
    );

    return {
      ...result,
      snippets: result.snippets.map((snippet) => ({
        ...snippet,
        target: snippet.id,
      })),
      targets: result.snippets.map((snippet) => snippet.id),
    };
  } catch (error) {
    logger.error({ error }, "Failed to generate prompt API snippets");
    return null;
  }
}

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

/**
 * Type representing the supported programming language/framework targets
 * for code snippet generation
 */
export type Target = (typeof AVAILABLE_TARGETS)[number];
