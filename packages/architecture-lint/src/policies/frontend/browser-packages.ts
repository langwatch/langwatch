/**
 * The packages that only make sense in a browser, and the prefix match over
 * them.
 *
 * Two guards ask the same question from opposite sides. The memory-footprint
 * guard (`tests/frontend-boundary.unit.test.ts`) asks whether backend code
 * reaches any of these; the frontend portability check in
 * `frontend-ui-boundaries.ts` asks whether a shared first-party module stays
 * clear of all of them. One list, so the two answers cannot drift: a package
 * added here starts being refused on the backend and stops counting as
 * portable in the same commit.
 *
 * The OpenTelemetry entries are deliberately narrow. Most of `@opentelemetry/*`
 * is isomorphic and the backend legitimately depends on it (`api`, `core`,
 * `resources`, `sdk-trace-base`, `semantic-conventions`, the OTLP exporters);
 * only these three are browser-bound — a `WebTracerProvider`, and
 * instrumentation for the DOM and `window.fetch`. Banning the scope wholesale
 * would make the guard unusable; leaving the scope out entirely is what let
 * the `@langwatch/react-rum` barrel reach three backend files unnoticed.
 *
 * `motion` is here alongside `framer-motion` because it is the same library
 * under its current name, and it is already a dependency of the web packages.
 * Listing only the old name is the same shape of gap.
 */
export const BROWSER_ONLY_PACKAGES = [
  "react",
  "react-dom",
  "react-router",
  "react-feather",
  "lucide-react",
  "framer-motion",
  "motion",
  "@chakra-ui",
  "@ark-ui",
  "@emotion",
  "@zag-js",
  "@opentelemetry/sdk-trace-web",
  "@opentelemetry/instrumentation-document-load",
  "@opentelemetry/instrumentation-fetch",
] as const;

/** The browser-only package a specifier names, or `undefined`. */
export function browserOnlyPackage(specifier: string): string | undefined {
  return BROWSER_ONLY_PACKAGES.find(
    (name) => specifier === name || specifier.startsWith(`${name}/`),
  );
}
