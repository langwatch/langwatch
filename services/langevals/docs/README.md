# LangEvals documentation (unmaintained)

**This directory is not published anywhere, and nothing in CI builds it.**

It is a second Mintlify site that predates the move of the docs into this
repository. It has had no substantive edit since February 2026, it still uses
the retired `mint.json` configuration format rather than `docs.json`, and
`docs-ci.yml` does not look at it — that workflow's path filter covers `docs/**`
and `skills/**` only, so nothing here is link-checked or validated.

Two things superseded it:

- **`docs/`** at the repository root is the live site, published at
  <https://langwatch.ai/docs>. Evaluator reference pages live under
  `docs/api-reference/evaluators/` and `docs/evaluations/evaluators/`.
- The live site **redirects `/langevals/:path*`** to
  <https://github.com/langwatch/langevals>, so no reader is routed here.

## If you are looking for evaluator docs

Edit them under `docs/` instead. Changes there are validated by `docs-ci` and
deployed by `docs-release` on merge to `main`.

## Restoring or retiring this directory

Nothing depends on it, so it can be deleted without affecting the build. That is
a publishing decision rather than a mechanical one, so it has been left in place
and labelled instead. If it is ever revived, it needs a `mint.json` →
`docs.json` migration and its own entry in the `docs-ci.yml` path filter, or it
will rot again in exactly the same way.
