// Smoke-test for issue #3754 — DO NOT MERGE.
// Expect ast-grep `no-export-star-shim` to flag the line below.
// Note: this file is NOT named `index.ts` (the old rule's overbroad ignore is
// gone — only `// @barrel` opts out, and we deliberately omit it here).

export * from "./pii-in-logger-violation";
