/**
 * The two module shapes this package's own `include` has to declare.
 *
 * The observability codegen imports its ~30 snippets with vite's `?raw` suffix,
 * which is a bundler feature rather than a TypeScript one, so nothing resolves
 * the specifier without this. It lives here rather than beside the codegen
 * because an ambient declaration is only in the program when the file holding it
 * is, and a consumer that reaches the registry through a subpath export never
 * pulls in a sibling `.d.ts`.
 */

declare module "*?raw" {
  const content: string;
  export default content;
}
