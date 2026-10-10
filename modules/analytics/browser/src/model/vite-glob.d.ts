/** The one `import.meta.glob` form the React typing loader uses (no vite/client here). */
interface ImportMeta {
  glob(
    patterns: readonly string[],
    options: { query: "?raw"; import: "default" },
  ): Record<string, () => Promise<unknown>>;
}
