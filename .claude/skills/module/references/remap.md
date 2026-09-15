# Remap: rename, repoint, or derive, then prove it with the tools

A remap changes names or import sources and nothing else: a `try*` member becomes
`find*`, a hand-written web procedure map becomes `ContractApiMap<typeof xTrpc>`, a
deleted export is repointed at its new home, a test double follows an interface it
stands in for. The work is mechanical; the proof is not optional. Every step below
runs, in this order, and the report pastes each output verbatim. A lane that skips a
step has not finished.

## 1. Find every occurrence before touching one

```bash
grep -rnE '\b<oldName>\b' packages apps tools --include='*.ts' --include='*.tsx' --include='*.mjs' | grep -v node_modules | grep -v /dist/
```

List the files by package. Anything outside your write scope goes in the report with
its line, untouched. A caller you did not know about is the usual way a remap ships
broken.

## 2. Apply the rule, not a guess

- Returns `T | null` or `T | undefined`: `find*`. The lint wants `find*` for every
  nullable answer, whatever the old verb was (`tryParseX` returning null is `findX`,
  not `parseX`).
- Returns a value and throws when it cannot: drop the prefix (`tryGetX` is `getX`).
- Does something and answers whether it did: drop the prefix, keep the verb.
- A test double follows the abstract member or interface it implements, exactly. A
  double that still declares the old name compiles as a fresh method and the test
  fails at runtime, not at the type level, unless the class is abstract.

## 3. Tests: the package's own suite, every package you touched

```bash
grep -o '"test[a-z:]*"' modules/<f>/server/package.json   # find the script name first
pnpm --filter @langwatch/<f>-server test:unit                        # or `test` when there is no test:unit
pnpm --filter @langwatch/<f>-contract test:unit
```

Before and after. Paste both summary lines. "Before" is what proves a red file was
red already.

## 4. Types: the package, then every package that imports it

```bash
pnpm --filter @langwatch/<f>-server typecheck
pnpm --filter @langwatch/<f>-contract typecheck
pnpm --filter "...@langwatch/<f>-contract" --filter "!@langwatch/platform-api" --filter "!@langwatch/worker" --filter "!@langwatch/ui" typecheck
```

The third line type-checks the workspace packages that depend on the contract; the
three applications are excluded because each is a whole-tree run that takes a
machine-wide slot. For the applications, step 1's grep is the check: an old name that
still appears under `apps/` is a break, list it. `TS6305` lines about
`dev/.cache/web-declarations` are a stale declaration cache, ignore them; any other
error in a file you touched is yours.

## 5. Lint: the rule you are serving, counted

```bash
npx oxlint -c .oxlintrc.jsonc modules/<f>/contract/src modules/<f>/server/src | grep -c <rule-name>
```

Before and after. The count for the rule goes to zero for `try*`; a remaining hit is
listed with its line and why it is not this remap's (a different rule, a pre-existing
finding on a line you did not touch). The naming rule reads every source file of a
module's contract and server, transports and adapters included.

## 6. The old name is gone

```bash
grep -rnE '\b<oldName>\b' modules/<f> --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v /dist/
```

Prints nothing, or every remaining line is a call into another package that renames in
its own module, listed as such.

## Report

A table first (old name, new name, file, rule applied), no preamble. Then files
changed, the outputs of steps 3 to 6 verbatim, and what you could not do with the exact
line. Under 80 lines.
