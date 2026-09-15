---
name: lint-rule
description: "Add or change a langwatch oxlint rule: the defineRule declaration in packages/oxlint-rules, its fixture-first unit test, its specs/tooling scenario, the one-line registration in the plugin registry and the config, the generated reference in dev/docs/lint-rules.md, and the measurement that says whether it ships at error or on the baseline. Use when a lint message is unclear or wrong, a rule fires where it should not, a new house rule is wanted, a baseline entry must be added or paid down, or someone asks why the plugin is slow."
user-invocable: true
argument-hint: "<rule name or the message that fired>"
---

# Add or change a langwatch lint rule

Every rule lives in `packages/oxlint-rules/src/rules/<rule>.rule.mjs`, is registered once in
`packages/architecture-enforcer/oxlint-plugin.mjs`, and is enabled once in
`packages/architecture-enforcer/oxlint.architecture.jsonc`. `dev/docs/lint-rules.md` is generated from those
declarations — read it before writing a new rule, so you extend the house grammar.

## 1. Decide the instrument first

- **A rule** when the fact is per-file, syntactic, and the fix is mechanical enough to
  state in one sentence.
- **A CLI graph check** (`packages/architecture-enforcer/src/*.ts`) when it needs the import
  graph, package manifests or a shrink-only inventory.
- **A test in the owning package** when only one module must hold the property.
- **A doc in `dev/docs/best_practices/`** when the rule cannot name a fix. Do not lint taste.

## 2. Measure before you write

Put the rule at `error` in a scratch config under `$TMPDIR`, never in the repo:

```bash
cat > "$TMPDIR/one-rule.json" <<EOF
{
  "plugins": [],
  "jsPlugins": [{ "name": "langwatch", "specifier": "$PWD/packages/architecture-enforcer/oxlint-plugin.mjs" }],
  "rules": { "langwatch/<rule>": "error" }
}
EOF
pnpm -s exec oxlint --disable-nested-config -c "$TMPDIR/one-rule.json" \
  apps packages sdks/typescript/src mcp/typescript/src | grep -c '<rule>'
```

Record the count and the date in the PR body. Zero hits: ship at `error`. Non-zero: fix
them, or baseline them (step 6). Never ship a rule that is `warn` everywhere.

## 3. Message contract, enforced by `defineRule`

A message is `what` + `fix`, joined. `why` is documentation and the linter never prints it.

- `what` names the offending symbol or path through `{{name}}`. No "cannot" or "may only"
  without the fix beside it.
- `fix` is one imperative sentence an agent can apply without opening another file.
- `why` is one clause, and only when the reason is not obvious. No history, no dates, no
  PR numbers.
- Name something the reader can see — a user-visible path or identifier, never an
  internal helper.
- The bar is `condition-shape` and `comment-block-size`. Read them before writing yours.

## 4. Write it fixture-first

1. `packages/oxlint-rules/tests/rules/<rule>.unit.test.mjs`, one `describe("when …")` per
   message id, valid and invalid:

   ```js
   const workspace = createFixtureWorkspace({
     features: { agent: { layoutVersion: 0, roles: { server: {} } } },
     catalogue: { agent: ["agent"] }, // feature id -> the subjects it claims
   });
   const found = runRule(rule, { code, cwd: workspace.cwd, filename });
   ```

   `createFixtureWorkspace` writes a throwaway tree, so a module rename cannot break the
   lint suite. Its `catalogue` option writes the real `catalogue.json` shape,
   `{ version, features: [{ id, subjects }] }`; pass `files` for anything else.
   `afterAll(() => workspace.cleanup())`.

2. Run it: `pnpm --filter @langwatch/oxlint-rules test:unit tests/rules/<rule>.unit.test.mjs`.
3. Write `packages/oxlint-rules/src/rules/<rule>.rule.mjs` with `defineRule`. Gate on
   `classify(context)` through the `applies` predicate — never parse the filename yourself,
   and never re-derive what `classify` already computed.
4. Register in `packages/architecture-enforcer/oxlint-plugin.mjs` (one line) and in
   `packages/architecture-enforcer/oxlint.architecture.jsonc` `rules` (one line, no filename lists).
5. Regenerate the reference and commit it:
   `pnpm --filter @langwatch/architecture-enforcer docs`.

## 5. Spec and binding

`specs/tooling/lint-<rule>.feature`, tagged `@unit`, one scenario per message id, and a
`/** @scenario "<exact title>" */` above each `it(`. An untagged or unannotated scenario
enforces nothing — see `.claude/skills/spec-bind/SKILL.md`. Verify:

```bash
pnpm --filter @langwatch/architecture-enforcer check:feature-parity 2>&1 | grep -A3 lint-<rule>
```

## 6. Baselines: when to record and when to fix

Existing debt lives in `packages/architecture-enforcer/src/oxlint-baseline.json` as
`rule|file` with a `measured` date — not as filename lists in the config. Baseline a file
only when the fix does not belong in this change; otherwise fix it, which is usually a few
lines. Adding an entry:

```bash
pnpm --filter @langwatch/architecture-enforcer lint   # the shrink-only check must pass
```

The register may only shrink against the merge base, so **renaming a file that carries an
entry reads as an addition**. Fix its findings and delete the entry in the same change.
A numeric `max` option tier is allowed only when the rule is numeric and the file cannot
be fixed now.

## 7. Cost: the plugin runs on every save and over ~13k files

- No `fs`, `child_process`, `new Date()` or JSON parsing inside `create` or a visitor.
  Read config once through the `baseline` / `classify` memos.
- No second parser. Use the ESTree node oxlint hands you; `import "typescript"` in a rule
  is a defect, and it is most of the plugin's cold start.
- Hoist every RegExp. Visit the narrowest node type. One pass per file per fact, shared
  through the per-file memo rather than a module `Map` keyed by content length.
- Prove it, and report both numbers:

  ```bash
  # cold import of the whole plugin graph
  node -e "const t=performance.now();import('./packages/architecture-enforcer/oxlint-plugin.mjs').then(()=>console.log(\`\${(performance.now()-t).toFixed(0)} ms\`))"
  # one rule over the governed paths, before and after
  time pnpm -s exec oxlint --disable-nested-config -c "$TMPDIR/one-rule.json" apps packages
  # the whole config, one file (the fast edit loop, ~1 s)
  time pnpm -s exec oxlint --disable-nested-config -c .oxlintrc.jsonc <file>
  ```

`pnpm lint` takes a machine-wide slot, so run it once and never beside a typecheck.

## Done when

Fixtures green, the scenario bound, `dev/docs/lint-rules.md` regenerated and committed,
the hit count and both timings recorded in the PR body, and the config diff is one line.
