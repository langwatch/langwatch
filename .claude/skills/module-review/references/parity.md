# Parity: composition, wiring, specs and tests

Owned by the `module-review` skill (`.claude/skills/module-review/SKILL.md`), which sets the order and routes here; this file carries sections 5 and 6 of the audit.

## 5. Composition and wiring

```bash
grep -n "\"$F\"" modules/catalogue.json
grep -rn "@langwatch/$F-process\|@langwatch/$F-server" apps/api/src apps/worker/src apps/tasks/src | grep -v __tests__
```

- The installer entered in `modules/catalogue.json` and installed through
  `createApp(...).withModules([...])`, generated into `processModules`
  (record §5) — never an app booted by hand, never a service passed around
  instead of the `*Api` token.
- **Any per-module mount file, composition file, or hand-built router under
  `apps/*` is a finding.** Those are deleted spellings (record §15); the
  installer's own `.withTransports(...)` plus `boot()` is the whole wiring.
- A `refusing*` / `Unavailable*` / `Logged*Absence` added for new work, or an
  optional collaborator nobody passes (inert leg). **What does the process
  actually supply?** Read the app's `main.ts`/`config.ts` (record §4, §6):
  which config slices, which stores, which peers resolve automatically by
  token, and which supply tokens the `.provide({...})` call answers. An
  optional dependency that is always supplied is not optional, and the
  `if (!this.x) throw` it forces is unreachable code wearing a type. Say
  which arguments are genuinely absent in production and which are not.
- Config read via `process.env` inside the module; a schema that is not
  `Config.define`/`Config.group`.
- The API appending events or running process managers (must be
  producer-only — record §9, role `api` never constructs a subscriber,
  projection or job).
- Browser: the module's own `./declaration` present and installed via the
  generated `browserModules` list; routes/screens registered through
  `defineBrowserModule`, not a hand-rolled `apps/ui` registration;
  `feature-map.json` current.

## 6. Specs and tests

- Scenarios untagged, or tagged but unbound; annotations naming a scenario
  that no longer exists; `.feature` files added to `LEGACY_INERT` or
  `LEGACY_UNBOUND`.
- Tests that assert a constant back at itself, tests with no assertion,
  `should` in names, describes without `given`/`when`, message-prose
  assertions.
- `<Name>Module` tested over memory repositories with `createApiFixture`
  peers; an installation test booting every role the installer serves
  (record §13); both backends covered by the same behaviours.
- A regression test that checks a string instead of executing the path.
- A change that adds or edits a skill under `.claude/skills/` / `skills/` or
  an MCP tool under `mcp/typescript/src/tools/` with no matching scenario in
  `specs/skills/skills-testing.feature`.
- Re-exports added for backwards compatibility anywhere: never allowed,
  update the importers.
- **Auditing a diff that converts or migrates a module**: compare old and
  new observable behaviour field by field: response DTOs, auth,
  error/status mapping, sorting, pagination/cursors, money/time units, query
  tables, retries, idempotency, side effects. A green package-test count is
  not proof of behaviour parity. Compare deleted tests against the coverage
  they carried; list every lost scenario as a finding until it is restored
  or the loss is named DELIBERATE with a reason.
