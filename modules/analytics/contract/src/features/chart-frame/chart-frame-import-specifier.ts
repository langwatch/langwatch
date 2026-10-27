/**
 * Rewrites a widget's `import` for the sandboxed ESM frame: a bare package
 * goes to esm.sh with React externalised, anything else is left alone.
 * SELF-CONTAINED — `author-runtime.ts` embeds its `.toString()`.
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 */
export function resolveImportSpecifier(specifier: string, builtins: readonly string[]): string {
  if (builtins.includes(specifier)) return specifier;
  if (specifier.startsWith("http://")) {
    throw new Error(`Module URLs must use https: (got "${specifier}")`);
  }
  const passthroughPrefixes = ["https://", "data:", "blob:", "/", "./", "../"];
  if (passthroughPrefixes.some((prefix) => specifier.startsWith(prefix))) {
    return specifier;
  }
  const separator = specifier.includes("?") ? "&" : "?";
  return "https://esm.sh/" + specifier + separator + "external=react,react-dom";
}

/**
 * The specifiers the frame satisfies from its own UMD globals through the
 * import map — never rewritten to esm.sh, so author code and the charts
 * library share one React/Recharts instance.
 */
export const CHART_FRAME_BUILTIN_MODULES = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "recharts",
  "@langwatch/charts",
] as const;
