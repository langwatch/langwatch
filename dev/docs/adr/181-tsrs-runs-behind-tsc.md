# ADR-181: tsrs runs behind `tsc`

**Date:** 2026-10-21

**Status:** Proposed

## Context

ADR-099 made `typescript@7` the compiler: `tsc` is the Go binary, reached through
a patched `lib/tsc.js` launcher that first takes a machine-wide slot from rush's
gate, haven, or a lock folder. Every package script, the Nx targets, haven's gate
hook and rush's shim spell the command `tsc`.

[tsrs](https://github.com/oxc-project/tsrs) is a Rust port of that compiler and
its language server, aiming at full conformance with TypeScript 7.1. Its version
names the upstream commit it ports (`0.18.0-ts7.1.0-dev.20260929`). TypeScript
7.1 has no stable release yet; the 7.1 beta and tsrs report the same diagnostics
on this tree.

Moving to 7.1 diagnostics found two things in the tree, both fixed here:

- zod 4.6.5's record and JSON types fail 7.1 with `TS5115` (instantiations
  appear infinitely circular). zod 4.6.7 fixes it.
- 7.1 no longer types a destructured parameter that has a default (`({ after } = {})`)
  from an optional contextual parameter. Eleven test fixtures now name the
  parameter type.

## Decision

**`tsc` runs tsrs.** The launcher patch resolves tsrs's binary and runs it in place
of the Go one; the slot, gate and haven handoffs are unchanged. Nothing that types
`tsc` changes, so no script, target, hook or doc is rewritten. tsrs is a
dependency of `typescript@7.0.2` through `packageExtensions`, so the launcher can
resolve it.

**The Go binary stays one switch away.** `LANGWATCH_TSC=tsgo` runs the binary
TypeScript 7.0.2 ships. A platform tsrs publishes no binary for (macOS on Intel,
Windows) falls back to it without being asked. On a platform tsrs does publish for, a
missing tsrs binary is an install fault: `tsc` says so and exits, rather than quietly
checking with the Go binary under 7.0 rules.

**The thread cap carries over.** tsrs ignores `GOMAXPROCS`, so the launcher passes
the same cap as `--checkers` (watch mode included) unless the caller already set
`--checkers` or `--singleThreaded`.

**`typescript` stays the library.** The `typescript/unstable/*` imports, the editor
and the packages held on 6 (ADR-099) are untouched.

**haven governs tsrs** as the same compiler class as `tsc` and `tsgo`
(`specs/setup/haven-tsgo-governor.feature`).

## Consequences

The whole-workspace build checks under 7.1 rules. Upstream 7.1 is still a dev
line, so a later tsrs release can move diagnostics. Bump tsrs deliberately and
read the build output. tsrs 0.18.0 was two days old when pinned, so it is listed
in `minimumReleaseAgeExclude` with its five platform binaries.

`tsc --version` now prints tsrs's version string. A report that only `tsc` reproduces
should be retried with `LANGWATCH_TSC=tsgo` before it goes upstream.

## References

- ADR-099: TypeScript 7 is the compiler
- ADR-095: haven tsgo governor
- `specs/setup/typescript-7.feature`
