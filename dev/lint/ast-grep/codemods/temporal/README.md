# `dev/lint/ast-grep/codemods/temporal/`

The mechanical half of the `Date` → `Temporal` migration that the `temporal-only`
oxlint rule asks for (`packages/lint-core/src/rules/temporal-only.rule.mjs`).

**These are rewrites, not lint rules.** They live outside the `ruleDirs` in
`../../sgconfig.yml` on purpose, so `pnpm lint`, `make lint-rules` and CodeRabbit
never see them and nothing applies a `fix:` behind your back.

```bash
# What would change, as JSON: file, the edits, and the sites declined with why.
node dev/lint/ast-grep/codemods/temporal/apply-temporal-codemod.mjs --files=<list>

# Same, but write the files.
node dev/lint/ast-grep/codemods/temporal/apply-temporal-codemod.mjs --apply --files=<list>
```

`--files=` takes a newline-separated list of paths; bare paths work too. Always
`pnpm -s exec oxfmt --write --disable-nested-config` the files afterwards.

## The rules

| rule | matches | becomes |
| --- | --- | --- |
| `temporal-now-epoch-milliseconds` | `Date.now()`, `new Date().getTime()`, `new Date().valueOf()` | `nowInstant().epochMilliseconds` |
| `temporal-now-iso-string` | `new Date().toISOString()` | `nowInstant().toString({ fractionalSecondDigits: 3 })` |
| `temporal-now-instant` | a bare `new Date()` | `nowInstant()` |
| `temporal-instant-from-iso` | `new Date(<one argument>)` | `Temporal.Instant.from(...)` |
| `temporal-instant-epoch-milliseconds` | `x.getTime()`, `x.valueOf()` | `x.epochMilliseconds` |
| `temporal-instant-iso-string` | `x.toISOString()` | `x.toString({ fractionalSecondDigits: 3 })` |
| `temporal-instant-compare` (4 rules) | `a < b`, `a > b`, `a <= b`, `a >= b` | `Temporal.Instant.compare(a, b) < 0`, … |
| `temporal-instant-since` | `a - b` | `a.since(b).total("milliseconds")` |

`fractionalSecondDigits: 3` is load-bearing. `Instant.toString()` drops the
`.000` that `Date.toISOString()` always prints, so the default would change the
bytes a caller logs, compares or puts on the wire.

## Why the driver exists

Every rule above except the first two is unsafe on its own, because ast-grep is
syntactic: `x.getTime()` is only `x.epochMilliseconds` once `x` is an instant,
and `new Date(v)` is only `Temporal.Instant.from(v)` once `v` is a string and
nothing downstream wants a `Date`. `apply-temporal-codemod.mjs` decides where
each rule may fire, from evidence in the same file:

- `Date.now()` and the chained `new Date().…` spellings produce a number or a
  string with no binding in between, so they are rewritten unconditionally.
- A `const` bound to `new Date()` or to `new Date(<string>)` becomes an instant
  only when EVERY later read of that name is one the rewrite keeps working —
  `getTime`, `valueOf`, `toISOString`, or an operand of a comparison or
  subtraction whose other side is also proven. The proof runs to a fixed point,
  so a pair only counts once both halves survive. One unaccounted read and the
  binding is left alone: that read is where a `Date` is still expected.
- `new Date(v)` admits `v` as a string only for a string or template literal, or
  for a name the same file annotates `: string`.
- A file that already binds `Temporal` or `nowInstant` from somewhere other than
  `@langwatch/time` is skipped whole rather than given a colliding import.

Deliberately **not** rewritten, because each ripples past the expression:
`Date`-typed declarations and interface fields, `toLocaleString` /
`toLocaleDateString` / `Intl` formatting, `setMonth` / `setDate` / `getMonth`
calendar stepping, `new Date(y, m, d)`, `Date.parse`, `Date.UTC`, test files, and
anything under `packages/time`, `repositories/prisma/`, `adapters/postgres.` or a
generated tree.

ast-grep reports byte offsets and JavaScript slices UTF-16 code units, so the
driver converts every offset before it reasons about one. Without that a single
non-ASCII character above a match puts the edit in the middle of the next
statement — and the result still parses often enough to reach a review.

## Adding the import

When a rewrite fires, `import { nowInstant, Temporal } from "@langwatch/time"`
is merged into an existing `@langwatch/time` import or added after the last
import in the file. The package also has to declare the dependency:
`"@langwatch/time": "workspace:*"`.
