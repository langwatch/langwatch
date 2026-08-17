/**
 * Externals whose absence at runtime is handled by the code that requires
 * them, so they are deliberately NOT declared in `dependencies`.
 *
 * Shared by the build's dependency check (scripts/build-server.mjs) and the
 * bundle's resolution guard (child-process-bundle.integration.test.ts) so the
 * two cannot disagree about what is allowed to be missing.
 *
 * Only add an entry after reading the guard that protects it — an unguarded
 * package listed here becomes a MODULE_NOT_FOUND at boot in production, which
 * is exactly what that dependency check exists to prevent (#5855).
 */
export const OPTIONAL_EXTERNALS = Object.freeze([
  // ws requires it inside a try/catch and falls back to its own JS validator.
  // It is a native addon, so it could not be inlined regardless.
  "utf-8-validate",
  // Lazily imported by the scenario SDK's Gemini Live voice adapter, which
  // throws a "not installed" error naming the package when it is missing.
  "@google/genai",
]);
