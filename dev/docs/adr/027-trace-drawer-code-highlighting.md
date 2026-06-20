# ADR-027: Trace drawer code highlighting — lazy on-demand Shiki language loading

**Date:** 2026-06-15

**Status:** Accepted

## Context

The trace drawer renders JSON, markdown, and fenced code blocks with Shiki,
through Chakra's `CodeBlock` adapter over a singleton highlighter
(`getSingletonHighlighter` from the `shiki` entry). The highlighter was
created with a fixed, hand-maintained list of languages. Two problems
followed:

- A fenced block in a language not on the list threw Shiki's
  "Language `promql` not found, you may need to load it first" — surfacing a
  raw error to operators instead of just showing the code.
- Coverage was limited to whatever was hand-listed; broadening it meant
  editing the list and eagerly loading every grammar at highlighter init.

Shiki's `shiki` entry already ships every grammar as a lazy async chunk, and
`loadLanguage` + the `bundledLanguages` map allow loading any grammar on
demand. Bundle options considered: `shiki/bundle/full` (~1.2 MB gzip, all
grammars as chunks), `shiki/bundle/web` (~695 KB gzip, curated web set), or
`shiki/core` + per-language dynamic import.

See [specs/traces-v2/code-block-language-fallback.feature](../../../specs/traces-v2/code-block-language-fallback.feature)
for the behavioural contract this decision supports.

## Decision

We will keep the `shiki` import and load languages on demand:

- The singleton highlighter boots with a small eager base — `json`,
  `markdown`, `bash`, `typescript`, `python` — covering the hot paths
  (attribute-value JSON, I/O bodies, transcripts) so the common case
  highlights with no flash.
- For any other language Shiki bundles, we lazy-load its grammar on first
  use via `loadLanguage(bundledLanguages[id])`, deduping in-flight loads.
  The block renders as plain text until the grammar resolves, then
  re-renders highlighted.
- A language Shiki does not bundle (e.g. `promql`) is coerced to plain
  `text` — never an error. Common fence aliases (`ts`, `js`, `py`, `sh`,
  `yml`, `md`, …) resolve to their canonical grammar before this check.

## Rationale / Trade-offs

This gives full coverage of Shiki's bundled languages without paying for
grammars nobody views, and removes the raw-error failure mode. We rejected
`shiki/bundle/full` and `shiki/bundle/web` because they fix coverage and add
baseline weight while our adapter already receives lazy chunks from the
`shiki` entry — on-demand `loadLanguage` is strictly more surgical. The
accepted trade-off is a brief un-highlighted flash the first time an
uncommon language appears (one load beat); the eager base avoids it for the
languages that actually dominate trace payloads.

## Consequences

- New languages need no list edits — any Shiki-supported language works.
- Highlighting is asynchronous for the long tail, so the render path must
  tolerate a plain → highlighted transition (a small render-gating hook in
  `ShikiCodeBlock` owns this).
- The "Language not found" error path is gone.
- Eager-base choices are now a deliberate, documented hot-path list rather
  than an ad-hoc accumulation.

## References

- Shiki bundles: https://shiki.style/guide/bundles
- Shiki languages: https://shiki.style/languages
- Spec: specs/traces-v2/code-block-language-fallback.feature
