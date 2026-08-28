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
