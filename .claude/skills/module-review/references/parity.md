# Parity: composition, wiring, specs and tests

Owned by the `module-review` skill (`.claude/skills/module-review/SKILL.md`), which sets the order and routes here; this file carries sections 5 and 6 of the audit.

## 5. Composition and wiring

```bash
grep -rn "@langwatch/$F-server" apps/api/src apps/worker/src apps/tasks/src | grep -v __tests__
grep -rn "$F" apps/api/src/app-trpc/app-trpc.features.ts apps/ui/src/features/installed-ui-features.ts apps/ui/src/features/catalogue.json
```

- The installer booted through `createApp(...).withModule(<f>Server)` with every declared
  token provided; an app constructed by hand, a service passed around instead of the token.
- A `refusing*` / `Unavailable*` / `Logged*Absence` added for new work, or an optional
  collaborator nobody passes (inert leg). **What does the composition root actually pass?**
  Find every `X.create` call in `apps/api/src/app/*.composition.ts`,
  `apps/api/src/features/*/*.composition.ts`, `apps/worker/src/app/*.composition.ts` and
  `apps/tasks/src/platform/*.composition.ts`: an optional dependency that is always
  supplied is not optional, and the `if (!this.x) throw` it forces is unreachable code
  wearing a type. Say which arguments are genuinely absent in production and which are not.
- Config read via `process.env` inside the module; a post-parse `assert*Config` instead
  of `Config.group`.
- The API appending events or running process managers (must be producer-only).
- UI: a `WebInstallation` (or `uiFeature`) in `apps/ui/src/features/<root>/index.ts`,
  routes wrapped by `uiPage` (host, guard, screen), page keys pinned in the install test,
  `feature-map.json` current.

## 6. Specs and tests

- Scenarios untagged, or tagged but unbound; annotations naming a scenario that no
  longer exists; `.feature` files added to `LEGACY_INERT` or `LEGACY_UNBOUND`.
- Tests that assert a constant back at itself, tests with no assertion, `should` in
  names, describes without `given`/`when`, message-prose assertions.
- The app tested over memory repositories with `createApiFixture` peers; an installation
  test booting every role the installer serves; both backends covered by the same
  behaviours.
- A regression test that checks a string instead of executing the path.
- A change that adds or edits a skill under `.claude/skills/` / `skills/` or an MCP tool
  under `mcp/typescript/src/tools/` with no matching scenario in
  `specs/skills/skills-testing.feature`.
- Re-exports added for backwards compatibility anywhere: never allowed, update the
  importers.
- **Auditing a diff that converts or migrates a module**: compare old and new observable
  behaviour field by field: response DTOs, auth, error/status mapping, sorting,
  pagination/cursors, money/time units, query tables, retries, idempotency, side effects.
  A green package-test count is not proof of behaviour parity. Compare deleted tests
  against the coverage they carried; list every lost scenario as a finding until it is
  restored or the loss is named DELIBERATE with a reason.
