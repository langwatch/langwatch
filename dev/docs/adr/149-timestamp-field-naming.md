# ADR-149: A timestamp field name carries its unit

Status: accepted, 2026-09-17

## Context

A field called `createdAt` does not say what it holds. Measured across
`modules/*/contract/src`, `packages/*/src` and `sdks/typescript/src` on
2026-09-17, the unsuffixed `*At` spelling is used **17,640** times and resolves
to at least four different runtime shapes:

| type behind a bare `*At` | occurrences |
| --- | --- |
| `Date` | 4,919 |
| `number` | 507 |
| `z.date()` | 254 |
| `z.number()` | 156 |
| `string` | 20 |
| `z.string()` | 53 |
| `Temporal.Instant` | 12 |

**663 of those are a plain number.** An epoch count under a name that does not
say "epoch" is ambiguous at every call site: seconds and milliseconds differ by
a factor of a thousand and both are plausible, so the only way to read
`run.startedAt - run.createdAt` correctly is to open the declaration. The tree
already reaches for a suffix when it remembers to — `*AtMs` appears 241 times,
`*TimeMs` 36, `*TimeSeconds` and `*TimeSec` twice each — but nothing required
it, so the habit is inconsistent.

The wire format itself is not the problem and is not being changed. The
observability SDK sends `{ started_at: number | null, finished_at: number | null }`
(`sdks/typescript/src/observability-sdk/evaluation/index.ts:89`) and the
collector's REST schema declares `started_at?: number` for the same field.
Epoch milliseconds on both sides, agreed, unambiguous once you know it is
milliseconds. `Date | number` at `:24` of that file is input ergonomics for SDK
callers, converted by `toEpochMillis()` at `:92` before anything is serialised —
no `Date` has ever gone over the wire.

What is missing is the unit in the name.

## Decision

**The suffix names the representation. New code only.**

| spelling | representation | example |
| --- | --- | --- |
| `createdAt` | ISO 8601 string | `"2026-09-17T14:33:13.210Z"` |
| `createdAtMs` | epoch milliseconds | `1789658793210` |
| `createdAtUnix` | epoch seconds | `1789658793` |
| `createdAtNano` | epoch nanoseconds | `1789658793210000000` |

`Unix` means seconds, which is what it means everywhere else. Milliseconds are
`Ms`, which is what the 241 existing `*AtMs` fields already say, so they are
conformant as written and none of them moves.

Three consequences of the table worth stating outright:

- **A bare `*At` is a string.** If the value is a number, the name is wrong, not
  the type.
- **A bare `*At` is never a `Date`.** That case is already governed by
  `langwatch/temporal-only`, which reports 247 `is typed Date` findings today
  and whose message already offers `string` as the remedy for a value that only
  ever comes off the wire. This ADR does not restate that rule and no new rule
  may report the same fact — see ADR-135 on one rule, one place.
- **Inside the platform a moment is still a `Temporal.Instant`**, per
  `langwatch/temporal-only`. This ADR governs the *name* of a field that has
  already been decided to hold a serialised timestamp: a wire contract, a log
  attribute, a stored column read back as a number. It does not license a new
  epoch count where an `Instant` belongs.

### What "new code only" means here, and why

It means exactly what ADR-146 means by it for `find*`: a new or moved field
takes the correct suffix, and the existing ones are left alone. The ~5,600
existing fields are not a backlog anyone is expected to clear.

This is deliberately *not* enforced by a lint rule today, and that needs saying
plainly because the reflex in this repository is to add one. Measured
2026-09-17, a rule reporting "a numeric timestamp whose name omits its unit"
would fire **672** times:

- **227 are in `modules/*/contract/src`.** Renaming one changes a JSON key on
  the wire. That is a breaking API change with a deprecation window, a dual-read
  period and an SDK release — a versioning project, not a lint fix.
- **445 are internal** to `packages/` and `apps/` and could be renamed safely,
  but each rename ripples through its call sites.

There is no baseline tier to park the remainder in: `dev/lint/oxlint.baseline.jsonc`
and the `rule|file` debt ledger were both deleted on 2026-09-17, every
`langwatch/*` rule is `error` tree-wide, and
`.claude/skills/lint-rule/SKILL.md` §6 is explicit that a rule which cannot
reach zero should have its scope narrowed to a real category or not ship at
all. A suffix rule scoped to "not the wire contracts" would still owe 445
renames before it could ship green.

So the sequence is: this ADR now, the 445 internal renames when someone wants
them, and `langwatch/timestamp-unit-suffix` scoped to `packages/**` and
`apps/**` on the day that count is zero. Shipping the rule before then would
mean either a suppression list — which no longer exists — or a red gate nobody
can turn green.

## Consequences

- A reviewer can reject `createdAt: number` by pointing at this table, with no
  rule needed.
- `*AtMs` (241 uses) and `*TimeMs` (36) are already correct and are not touched.
  `*TimeSeconds` (2) and `*TimeSec` (2) are the odd spellings; prefer
  `*TimeUnix` in new code, and leave those four alone.
- The epoch-millisecond wire format of the evaluation timestamps is unchanged.
  Any move to ISO 8601 on that wire is a separate, breaking decision this ADR
  does not take.
- A field that holds a duration is not a timestamp and takes none of these
  suffixes. `Date.now() - startTime` is an elapsed measurement — 116 such sites
  exist in `sdks/typescript` alone — and belongs in a `durationMs` or, where a
  monotonic source matters, `performance.now()`.
- When the rule does ship it must not report `*At: Date`. That finding belongs
  to `langwatch/temporal-only` and duplicating it across two engines is the
  defect ADR-135 exists to prevent.
