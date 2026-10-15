/**
 * The syntax-highlighter language names the API-snippet surfaces pass around.
 * Taken from `@react-email/components` (a SERVER-side renderer) rather than
 * pulling a mail library into a browser package for one string union.
 */
export type PrismLanguage =
  | "bash"
  | "css"
  | "go"
  | "graphql"
  | "html"
  | "javascript"
  | "json"
  | "jsx"
  | "markdown"
  | "php"
  | "python"
  | "ruby"
  | "sql"
  | "tsx"
  | "typescript"
  | "yaml";
