---
name: overengineering-audit
description: "Audit a package, feature or directory for over-abstraction: identity functions, pass-through layers, ports with one implementation, optional dependencies production always supplies, conditional types that derive what a value could state, and comment blocks that are really incident reports. Runs the mechanical detectors first, then reads what they cannot see, and reports with file:line evidence and a target shape. Use when the user says 'this is overengineered', 'too many tiny files', 'simplify this', 'audit for over-abstraction', or asks for a feature cleanup review."
user-invocable: true
argument-hint: "[package path, feature name, or directory]"
---

# Overengineering audit

Read `dev/docs/best_practices/overengineering.md` and
`dev/docs/best_practices/feature-cleanup-review.md` first. They hold the rules
(R1–R8), the reference for what "simple enough" looks like (the Go config), and
the keep list. This skill is the procedure for applying them.

The target is code that is **simple to read and simple to use**. Not fewer
lines — fewer things a reader has to hold in their head at once.

## 1. Run the detectors before reading anything

They are cheap and they aim your attention. From the repo root:

```bash
# Identity functions and same-name delegation, with file:line
uvx --from ast-grep-cli==0.42.3 ast-grep scan -c dev/lint/ast-grep/sgconfig.yml \
  --filter 'no-identity-function-ts|no-same-name-delegation-ts' --json=compact

# layer-class, conditional-type-depth, overload-by-literal, comment-block-size,
# service-quality, strict-port-module and the rest
cd packages/architecture-lint && pnpm run lint
```

Then the shape survey, which no rule covers:

```bash
T=packages/features/<name>/server/src
# layer inventory
for d in $(find $T -type d -not -path "*__tests__*"|sort); do \
  n=$(find "$d" -maxdepth 1 -name "*.ts" -not -name "*.test.ts"|wc -l); \
  [ "$n" -gt 0 ] && printf "%4s  %s\n" "$n" "$d"; done
# comment-heavy files
find $T -name "*.ts" -not -path "*__tests__*" | while read f; do \
  c=$(grep -cE '^\s*(//|/\*|\*)' "$f"); k=$(grep -cvE '^\s*(//|/\*|\*|$)' "$f"); \
  [ "$k" -gt 0 ] && [ "$c" -ge "$k" ] && echo "$c cmt / $k code  $f"; done
# single-consumer modules
for f in $T/services/*.ts; do b=$(basename "$f" .ts); \
  n=$(grep -rl "/$b\"" --include="*.ts" $T | grep -v __tests__ | grep -v "$f" | wc -l); \
  echo "$n  $b"; done | sort -n | head
```

Use `grep -rn`, not ripgrep — `rg` returns incomplete results in this repo.

## 2. Read what the detectors cannot see

Four questions, in this order. Each needs a `path:line` answer.

**Where does a database client stop?** (R1) A service takes a repository, never
a `PrismaClient`, `Prisma.TransactionClient` or ClickHouse client. If a service
opens a transaction or writes raw SQL, that belongs behind the repository, and
the callback should receive a transactional *repository*, not a client.

**What does the composition root actually pass?** (R5) Find every
`XApp.create` / `XRuntime.create` call in `platform/app/src/server/app-layer/presets.ts`,
`platform/app/src/runtime/`, and `apps/`. An optional dependency that is always
supplied is not optional; the `if (!this.x) throw new Error("… not configured")`
it forces is unreachable, and the type is lying. Say which arguments are
genuinely absent in production and which are not.

**How many implementations does each port have?** (R4)
`grep -rn "implements XPort\|extends XPort"`. Two or more, or one in a
different package, and it stays. One, in the same package, and it is a seam to
nowhere. Never propose collapsing a port with real polymorphism.

**Do the errors carry their own status?** (R6) A `Record<string, {status}>`
keyed on `error.name`, or an `instanceof` ladder in a router, means the errors
are plain `Error`s and every transport re-derives the mapping. Check whether the
class the transport tests is the class the runtime throws — where a contract
and a server package both declare the name, `instanceof` is silently always
false.

## 3. Do not invent work

Say what stays, and why, in a Keep list. These are correct as they are:

- a port with two or more implementations, or one across a package boundary;
- an open set with one file per member — one canonicaliser per vendor, one
  adapter per provider — where a new member touches nothing else;
- `app/<feature>.app.ts`, the one facade both transports call, which the
  feature layout requires;
- a hot correctness path already inside its quality ceiling, where the only
  complaint is method length;
- anything under `platform/app/` — new files go in `packages/**` or `apps/**`.

A rule firing is a question, not a verdict. Check each hit against the source
before reporting it, and drop the ones that are idioms: `(x) => x` as a no-op
default, `.filter((x) => x)` as a truthiness filter, a routed repository
delegating by verb.

## 4. Report

Six sections, matching `dev/docs/plans/feature-cleanup/dataset.md`:

1. **What is there now** — files, lines, and the layer stack as an ASCII
   diagram from transport to datastore, with each layer's method count.
2. **Problems** — numbered, each citing `path:line` and the rule it breaks.
3. **What it should look like** — target tree with per-file line estimates, and
   real code sketches for the two or three biggest moves.
4. **Keep list** — with reasons.
5. **Cost and order** — commits, smallest-risk first, each leaving the suite green.
6. **Blast radius** — how many files outside import it, and which symbols.

Write it to `dev/docs/plans/feature-cleanup/<name>.md`.

A review that says "could be cleaner" is worthless. A review that says
"22 of 26 `DatasetApp` methods are one-line pass-throughs, `app/dataset.app.ts:226-300`"
can be acted on.
