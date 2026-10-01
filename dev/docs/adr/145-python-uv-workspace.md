# ADR-145: One Python uv workspace

**Date:** 2026-09-13

**Status:** Accepted

**Behavioural contract:**
[Python uv workspace](../../../specs/dependencies/python-uv-workspace.feature)

**Related:** [ADR-076: single pnpm workspace](./076-single-pnpm-workspace.md)
(the same decision for JavaScript).

## Context

The repository's Python projects each carried their own uv resolution:
`sdks/python`, `packages/ksuid-python` and `services/langevals` each had a
`uv.lock`, and each was its own install root. That is the state ADR-076
eliminated for JavaScript, and it fails the same ways here:

- **Security pins applied in one root were absent from the others.** The SDK's
  `[tool.uv] constraint-dependencies` block carries seven CVE pins; nothing
  made those pins hold for ksuid-python, and a future Python member would have
  started with none.
- **Nothing connected the projects.** The SDK depends on the third-party
  `pksuid` while the repository ships its own `langwatch-ksuid` — a path
  dependency is unexpressible across independent roots, so the house library
  sat unused beside its own SDK.
- **Every root re-resolved and re-cached its own dependency tree** in CI, with
  its own `cache-dependency-glob` to keep pointed at the right lock.

## Decision

A uv workspace at the repository root, declared in a **virtual**
`pyproject.toml` — no `[project]`, nothing builds or publishes from the root —
with one `uv.lock` and one `.venv` beside it. Initial members:

```toml
[tool.uv.workspace]
members = ["sdks/python", "packages/ksuid-python"]
```

Resolution-level settings (`exclude-newer`, the security
`constraint-dependencies`) move to the root `[tool.uv]` block, where uv
actually honours them — a member's `[tool.uv]` resolution settings are
silently ignored, so leaving them on `sdks/python` would have made the pins
decorative the moment the workspace existed.

Members keep everything package-shaped: their own `pyproject.toml`, version,
build backend, release-please component, publish workflow and PyPI identity.
`uv sync` / `uv run` from a member directory target that member against the
shared lock. `uv build` needs `--out-dir dist` in workflows, because a
workspace build otherwise lands in the root `dist/`.

**`services/langevals` stays out deliberately.** A uv workspace resolves every
member into one lockfile, and the evaluator packages are a dependency zoo
(ragas, presidio, lingua and friends) with a prerelease cadence of their own;
forcing them into the SDK's resolution would let an evaluator pin veto an SDK
upgrade and vice versa. It is already its own multi-package workspace and
keeps its own lock. Revisit if its dependency surface ever shrinks.

The shared lock resolves against the intersection of the members'
`requires-python`. That put ksuid-python's floor at 3.10 (from the SDK's
`>=3.10,<3.14`); since Python 3.9 reached end of life in October 2025 and no
released ksuid version ever claimed it, the floor was raised rather than
carving the member out of the workspace.

## Consequences

- One `uv.lock` at the root; member lockfiles are deleted and must not
  reappear (the spec binds a test for this).
- CI `cache-dependency-glob` entries point at the root lock, and workflows
  that path-filter on a member also watch `uv.lock`, `pyproject.toml` and
  `.python-version` at the root — a re-lock re-pins every member.
- A matrix job that installs several interpreters must set `UV_PYTHON`;
  the root `.python-version` (3.11) would otherwise pin every leg.
- The root `.venv` is shared and synced exactly: syncing one member prunes
  another's dev packages until the next `uv sync`/`uv run` there. Harmless
  locally (uv re-syncs per `uv run`), irrelevant in CI (separate runners).
- `sdks/python` can now take `langwatch-ksuid` as a workspace dependency and
  retire `pksuid` — a follow-up, not part of this change, because swapping the
  identifier library changes generated ID formats.
