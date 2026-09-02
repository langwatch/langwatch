/**
 * `import.meta.env`, for the one panel read that asks the bundler what mode it
 * is in.
 *
 * `LangyPanel` gates its developer drawer on it. Declared here rather than
 * pulled in through `types: ["vite/client"]`, which would put every Vite
 * ambient into a package that does not build with Vite.
 */
interface ImportMeta {
  readonly env: Record<string, string | boolean | undefined>;
}
