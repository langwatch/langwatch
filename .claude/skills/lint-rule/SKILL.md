---
name: lint-rule
description: "Add or change a langwatch oxlint rule: the defineRule declaration in packages/oxlint-rules, its fixture-first unit test, its specs/tooling scenario, the one-line registration in the plugin registry and the config, the generated reference in dev/docs/lint-rules.md, and the measurement that proves the tree is clean before it ships at error. Use when a lint message is unclear or wrong, a rule fires where it should not, a new house rule is wanted, existing findings need fixing to zero before a rule can ship, or someone asks why the plugin is slow."
user-invocable: true
argument-hint: "<rule name or the message that fired>"
---

# Add or change a langwatch lint rule

Every rule lives in `packages/oxlint-rules/src/rules/<rule>.rule.mjs`, is registered once in
the `rules` map of `packages/oxlint-rules/src/index.mjs` (keyed by the name its `defineRule`
declaration carries), and is enabled once, at `error`, in
`packages/architecture-enforcer/oxlint.architecture.jsonc`. The plugin-config guard
(`packages/oxlint-rules/tests/plugin-config.unit.test.mjs`) refuses a rule at `warn`, a
registered rule no config enables, and a configured rule the registry does not hold.
`dev/docs/lint-rules.md` is generated from those declarations — read it before writing a new
rule, so you extend the house grammar.

## 1. Decide the instrument first

- **A rule** when the fact is per-file, syntactic, and the fix is mechanical enough to
  state in one sentence.
- **An architecture-enforcer policy** (`packages/architecture-enforcer/src/policies/`,
  registered in `policies/index.ts`) when it needs the import graph, package manifests or
  the whole catalogue. It runs under `pnpm lint:architecture`, not `pnpm lint`.
- **A native oxlint rule or `overrides` block in `.oxlintrc.jsonc`** when a built-in already
  means the same thing (ADR-135: the lowest layer that can express it).
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
them — there is no baseline tier to defer the rest to (step 6). Never ship a rule that is
`warn` everywhere.

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

2. Run it: `pnpm --filter @langwatch/oxlint-rules test tests/rules/<rule>.unit.test.mjs`.
3. Write `packages/oxlint-rules/src/rules/<rule>.rule.mjs` with `defineRule`. Gate on
   `classify(context)` through the `applies` predicate — never parse the filename yourself,
   and never re-derive what `classify` already computed.
4. Register it: import it in `packages/oxlint-rules/src/index.mjs` and add it to `RULES` (and the
   export list), then add one `"langwatch/<rule>": "error"` line to
   `packages/architecture-enforcer/oxlint.architecture.jsonc` `rules` (no filename lists).
   `pnpm --filter @langwatch/oxlint-rules test tests/plugin-config.unit.test.mjs` proves the two agree.
5. Regenerate the reference and commit it:
   `pnpm --filter @langwatch/architecture-enforcer docs`. CI runs `docs:check`, which fails on a
   stale reference.

## 5. Spec and binding

`specs/tooling/lint-<rule>.feature`, tagged `@unit`, one scenario per message id, and a
`/** @scenario "<exact title>" */` above each `it(`. An untagged or unannotated scenario
enforces nothing — see `.claude/skills/core/testing-rules.md`. Verify:

```bash
pnpm --filter @langwatch/architecture-enforcer check:feature-parity 2>&1 | grep -A3 lint-<rule>
```

Then give the rule a decision row — first cell the rule id in backticks, layer `plugin`, one
line of meaning — in the ADR table headed `| Rule | Layer | Meaning |` of the family it belongs
to (ADR-135, 137 to 142). The
guard `packages/architecture-enforcer/tests/lint-rule-records.unit.test.mjs` fails when a rule
has no row or no spec, and when a row names a rule that no longer exists: deleting a rule
deletes its row and its feature file in the same change.

## 6. There is no baseline any more

`dev/lint/oxlint.baseline.jsonc` (per-file overrides) and the rule-debt ledger,
`packages/architecture-enforcer/src/oxlint-baseline.json` (`rule|file` rows with a
`measured` date), are both deleted, and nothing replaces either. Every `langwatch/*`
rule is `error` tree-wide, on every file it governs, with no per-file exemption and
no register to add a finding to. Non-zero findings from step 2's measurement get
fixed to zero before the rule ships — there is no "baseline it for later." If a rule
cannot reach zero because the fix is genuinely a separate, larger change, that is a
reason to narrow the rule's scope (a glob naming a real category, never a list of
files) or hold off shipping it at all, not to reintroduce a suppression list.
A numeric `max` option tier is allowed only when the rule is numeric and a lower
threshold cannot yet be met honestly.

## 7. Cost: the plugin runs on every save and over ~13k files

- No `fs`, `child_process`, `new Date()` or JSON parsing inside `create` or a visitor.
  Read config once through the `classify` memo.
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

Fixtures green, the scenario bound, the ADR row written, `dev/docs/lint-rules.md` regenerated
and committed, the hit count and both timings recorded in the PR body, and the config diff is one
line.
