/**
 * Browser-only packages. Used by both backend boundary guard and frontend portability check,
 * so changes propagate together. OpenTelemetry entries are deliberately narrow (only the
 * three browser-specific: `WebTracerProvider`, DOM/`window.fetch` instrumentation).
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
