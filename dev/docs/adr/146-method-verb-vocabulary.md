# ADR-146: The verbs a method may be named with

**Status:** accepted, 2026-09-17
**Supersedes nothing.** Extends the ruling recorded in CLAUDE.md's
"Writing a new method that returns `T | null`" row into the full vocabulary.

## Context

`langwatch/fallible-result-naming` reported 796 findings. Almost none of them
were what the rule was aimed at. It was written to catch a method that
**swallows a failure and hands back null** — the `tryGetThing()` shape — but it
fires on any method whose return type includes `null` or `undefined`, whatever
the method is for.

Measured by the verb each flagged method actually starts with:

| verb | findings |
| ---- | -------- |
| `resolve*` | 63 |
| `read*` | 40 |
| `get*` | 27 |
| `map` / `pick` / `infer` / `describe` | 22 |
| `find*` | 0 — already exempt |

The rule already exempts conversions (`parse`, `format`, `normalize`, `derive`,
`compute`, `build`, `to*`, `as*`) on the reasoning that a conversion is handed
the value it converts, so absence means "the input carried none", not "no such
record". That reasoning covers more verbs than the list names.
`inferOriginFromLegacyMarkers(span): string | undefined` walks a table of legacy
markers and returns nothing when none matches. Nothing is a correct answer.
Renaming it `get*` and throwing would make a normal outcome an exception;
renaming it `find*` would promise an array it does not return.

The verbs the tree actually uses were never written down, so each rule encoded a
fragment of them and none of the fragments agreed.

## Decision

**Reads.**

| verb | contract |
| ---- | -------- |
| `get<Noun>` / `getBy<Key>` | exactly one, or throws. Never nullable. `getBy<Key>` only when the key distinguishes the method and the entity itself comes back (`getById`, `getByEmail`). |
| `find<Noun>` | an array. The empty array is the absence. |
| `list<Noun>` | a collection or a page. Service vocabulary; a repository answers `find*`. |

**A keyed read that may miss is a `get*`** (Alex, 2026-09-24). One thing by its key
that may not exist throws the module's not-found `HandledError`; a caller for
whom absence is normal catches that error's `code` and nothing else. It is never
a `find*` returning an array of at most one for the caller to destructure.

**Writes.** `create`, `update`, `delete`, `upsert`, `archive` — the five the
tree already uses. A write whose target may normally be absent returns an
explicit result union rather than null.

**Derivations.** A derivation is handed its input and computes an answer from
it. It never looks anything up, so `undefined` from one means "the input carried
none" and is a correct answer, not a failure:

```
parse · extract · build · stringify · serialize · deserialize · format · render
normalize · coerce · decode · encode · convert · derive · compute · translate
project · visit · as* · to*            (already exempt)
infer · classify · detect · pick · describe · map          (added by this ADR)
fold · reduce          (Alex, 2026-09-24: event reducers; state is null before the first event)
```

A lookup in a **fixed in-code table** keyed by the input is a derivation too (Alex, 2026-09-24): the table is part of
the code, not a store, so a miss means "the input names nothing in it" — name it `pick*`/`map*` (a model catalogue's
`pickModelById`). A table read from a store, config or a peer is a lookup and follows the `get*`/`find*` rules.

**`resolve*` and `read*` stay governed.** They are the two verbs that read both
ways — `resolveOriginFromSpan` is a derivation, `resolveProjectId` is a lookup
that should throw — and 103 findings sit on them. A blanket exemption would
bless the lookups along with the derivations. Each is decided at its own call
site: rename to `get*`/`find*` where it looks something up, or to a derivation
verb where it computes.

**`try*` is never a verb.** It names how a method behaves on failure rather than
what it answers, and `langwatch/banned-verb-prefix` says so (it absorbed
`no-try-prefix` on 2026-09-23, with the `require*` ban beside it).

## Consequences

- `fallible-result-naming` falls by about 22 immediately, and by up to 103 more
  as `resolve*`/`read*` are decided individually.
- Superseded 2026-09-23 (Alex, "no dropping"): the existing nullable `find*` and
  `try*` methods are converted to this vocabulary, callers included (lint wave W6).
- A new verb belongs in one of the three groups above or it does not belong.
  Adding one means editing this ADR, the exemption list in
  `packages/oxlint-rules/src/rules/fallible-result-naming.rule.mjs`, and the
  scenarios in `specs/tooling/lint-fallible-result-naming.feature`.

## Where this is enforced

- `packages/oxlint-rules/src/rules/fallible-result-naming.rule.mjs` — the
  derivation and repository vocabularies
- `packages/oxlint-rules/src/rules/banned-verb-prefix.rule.mjs` — the `try*` and `require*` bans
- `.claude/skills/architecture-guide/references/server.md` — the table a lane reads
- CLAUDE.md — the row that points here

## Amended 2026-09-23

An assertion — a method that returns nothing and throws when its condition does
not hold — is named `assert<Condition>`. It answers no value, so it is neither a `get*`
nor a `find*`. `require*` stays banned: it was the old spelling of exactly this shape,
and `assert*` replaces it rather than joining it.
