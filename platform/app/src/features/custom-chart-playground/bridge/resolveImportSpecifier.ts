/**
 * Rewrites a widget's `import` specifier for the sandboxed ESM frame.
 *
 * Author code is compiled to ESM and loaded via `import()` of a blob URL, so
 * every specifier must resolve to something a browser can fetch. Bare package
 * specifiers (`dayjs`, `@tanstack/react-table`, `lodash-es/debounce`) have no
 * URL, so they are pointed at esm.sh with React externalised — esm.sh then
 * imports "react"/"react-dom" itself, which the frame's import map re-maps to
 * the single UMD React instance the author's own tree renders against (a
 * bundled second copy would break the rules of hooks). The built-in modules
 * the frame provides as globals, and anything that is already a URL / data: /
 * blob: / absolute or relative path, are left untouched.
 *
 * SELF-CONTAINED on purpose: `authorRuntime.ts` embeds this function's
 * `.toString()` into the frame script, so it may close over nothing at module
 * scope, import nothing, and use only ES2017 syntax. `builtins` is passed in
 * (never read from a closure) for the same reason.
 *
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 */
export function resolveImportSpecifier(
  specifier: string,
  builtins: readonly string[],
): string {
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
