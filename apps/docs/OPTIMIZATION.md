# Docs optimization decisions

Keep the approved UI, shared React components, and a complete static artifact.
Required reading stays independent of React, Chakra, schema validation, syntax
highlighting and Markdown compilation in the browser. Measure complete interaction
costs as well as the initial script; a small bootstrap does not describe search,
CSS or images.

## Implemented priorities

- Content-addressed page rendering, bounded renderer threads, shared compilation
  context and output integrity checks. Caches are disposable, and failures must
  fail the build rather than publish a partial page set.
- Explicit design-system recipe selection for menus and search, preserving the
  full system for prerendering and existing product callers.
- Zod Mini for browser boundaries, with regular Zod for filesystem/build inputs.
  Keep one schema authority and verify defaults, recursion and strict credentials.
- Parsed search data reused by build version, normalized once. Preserve global
  article, heading, API and typo coverage when considering another engine.
- Responsive WebP imagery, intrinsic dimensions, and short video replacements
  for the three referenced prompt GIFs. Keep playback optional and respect motion
  preferences.
- Scoped, bounded offline caches and deliberate prefetch with save-data guards.
  Native Haven hosting supports `/docs` without capturing other app requests.
- Content-addressed Brotli/gzip variants for the complete search index. Native
  hosting negotiates those variants and preserves video Range requests.
- Static canonical/social metadata, factual breadcrumbs, complete API exports,
  guide snippet expansion and section-grouped agent discovery.

## Recommendations to retain

| Candidate                              | Decision and next evidence                                                                                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Go static generation                   | Keep React/MDX compilation in Node. Measure cached generation first; only port a demonstrated filesystem bottleneck. Go already serves Haven's static artifact.                                    |
| Pagefind / MiniSearch                  | Compare complete cold delivery, initialization, query latency and article/API/heading/typo recall. Library bytes alone are insufficient. Preserve the existing command surface.                    |
| Ark / Zag / Panda                      | These change styling or behavior ownership. Consider a bounded shared-design-system experiment only after recipe selection leaves a measured bottleneck.                                           |
| Preact compatibility                   | No initial-reading benefit here. Require React Compiler, portal, overlay and shared-component compatibility evidence before changing runtime.                                                      |
| Zod compilation / alternate validators | Mini is the first browser experiment. Compilation targets repeated validation throughput and adds runtime code; replacements must preserve parse semantics.                                        |
| Bundling                               | Inspect retained modules and duplicate resolved packages. Avoid a blanket vendor chunk that makes menus download search-only code. Keep build/test packages outside browser reach.                 |
| Delivery compression                   | Enable Brotli/gzip and revalidation in the eventual hosting workflow. Retain old hashed assets for open tabs. Validate actual GET/HEAD status, MIME, redirects and cache headers after deployment. |
| Search and agent outcomes              | Track retrieval reliability separately from human usage, search exposure and citations. Test tasks starting only with `llms.txt`, including quickstarts, SDK setup and exact API authentication.   |
| Optional agent features                | Add topic bundles, content negotiation or MCP only for a demonstrated consumer. More aliases or schemas do not establish ranking gains.                                                            |

Production hosting and measurement remain separate from this app. Deployment
belongs in GitHub Actions. Verify genuine 404 responses, canonical aliases,
Markdown response policy and crawler access at the real edge. Choose training
crawler policy explicitly; it is separate from search/retrieval access. Do not
invent modification dates, authors, FAQ content or analytics facts.

Useful primary references: [Chakra bundle selection](https://chakra-ui.com/guides/component-bundle-optimization),
[Zod Mini](https://zod.dev/packages/mini), [React Compiler](https://react.dev/learn/react-compiler/introduction),
[Pagefind API](https://pagefind.app/docs/api/), [MiniSearch](https://github.com/lucaong/minisearch),
[Vite performance](https://vite.dev/guide/performance),
[Google AI search guidance](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide),
[crawlable links](https://developers.google.com/search/docs/crawling-indexing/links-crawlable),
[canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls),
[Web Vitals](https://web.dev/articles/vitals) and [llms.txt](https://llmstxt.org/).
