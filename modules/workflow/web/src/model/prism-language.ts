/**
 * The syntax-highlighter language names the API-snippet surfaces pass around.
 *
 * `platform/app` took this type from `@react-email/components`, which is a
 * SERVER-side email renderer that happens to re-export it: a browser package
 * pulling in a mail library for one string union would be the tail wagging the
 * dog. The union is the set of languages the snippet dialogs actually offer.
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
