# Domains drive

Goal: dependency direction is correct and enforced. Concretely:

- framework packages know no feature;
- core never imports enterprise;
- modules form layers (`domain-map.md`) with a peer-cycle baseline of 0;
- one vocabulary.

Manifests: `.claude/manifests/dd-NN-*.md`. Collected state: `.claude/coordinator/LANES.md`.

## Gates (nothing starts before its gate)

| Gate | Opens when | Blocks |
|---|---|---|
| G0 clean base | The in-flight lanes are collected and the dirty tree is committed; fewer than 8 lanes running | Wave 1 |
| G1 rulings | Alex rules on `domain-map.md` (five questions, and the cut table as one batch) | Wave 2 |
| G2 merge landed | The origin/main merge drive has landed | Wave 3 |

## Waves

```
G0 ─► W1  dd-01 dd-02 dd-03 dd-04 dd-05 ──► dd-06 (after dd-04 and dd-05 are collected)
G1 ─► W2  dd-07 dd-08 dd-09 dd-10 dd-11 dd-12 dd-13          (7 at once)
G2 ─► W3  dd-14 ──► dd-15                                    (serial)
```

| Lane | Work | Agent | Wave |
|---|---|---|---|
| dd-01 | Nurturing inversion: owners stop knowing nurturing | lane-sonnet | 1 |
| dd-02 | Auth off enterprise (sso sign-in providers, licensing reads) | lane-opus (high: sign-in) | 1 |
| dd-03 | Entitlement reads sources supplied by billing and licensing | lane-sonnet | 1 |
| dd-04 | Remaining core → enterprise edges (coding-agent, model-provider, ops, user, organization → governance and billing) | lane-sonnet | 1 |
| dd-05 | Browser hubs, expand: owner contracts gain declaration, drawer and client types | lane-opus-medium | 1 |
| dd-06 | Browser hubs, switch and delete: 157 declaration/drawer importers, about 98 workflow-api importers, slots | lane-sonnet (tslsp) | 1b |
| dd-07 | Routes into modules: `ui-route-table.ts` (947 lines) becomes composition only | lane-sonnet | 2 |
| dd-08 | process-server transport reads supplied credential, permission and session tokens | lane-opus (high: auth) | 2 |
| dd-09 | Tenancy: sessions, membership, personal workspace, scim/identity | lane-opus (high: authz) | 2 |
| dd-10 | Project hub: api-key, share, data-privacy, langy, role, audit-log edges | lane-opus-medium | 2 |
| dd-11 | Commercial: `usage` module, bounds source, platform admin move, spend events | lane-opus-medium | 2 |
| dd-12 | Authoring cascade: archive/copy as events across workflow, agent, evaluator, monitor, experiment, dataset | lane-sonnet | 2 |
| dd-13 | Ingest seams: span contributors, trace reactions as subscribers, log merged into trace, evaluation edges | lane-opus-medium | 2 |
| dd-14 | Merge suite into scenario | lane-sonnet | 3 |
| dd-15 | Renames: one vocabulary, kernel split, §16 deleted, `#/` aliases | lane-sonnet (tslsp) | 3 |

That's 8 Sonnet lanes and 7 Opus lanes (three on high effort, four on medium).
Sonnet lanes spawn with no model override.

## Rules that prevent overlap

1. **Lanes own modules, not concerns.** Within a wave, no two lanes own the same
   module directory. The owned paths in the manifests are disjoint; check them by
   eye before each spawn.
2. **Hotspot files have one owner per wave.** These are `*.app.ts`,
   `package.json`, contract `index.ts`, `catalogue.json`, the generated
   installed lists, the baselines, `pnpm-lock.yaml` and `ARCHITECTURE.md`. The
   module's owning lane owns its `app.ts` and `package.json`. The coordinator owns
   everything else in that list. Anyone else writes the exact lines they need into
   handoff §10.
3. **Expand, switch, contract.** Add the new home, move the callers, then delete
   the old one. Never a shim. A deletion lands only once its last importer is
   gone (`git grep` proves it).
4. **Process lanes don't touch `browser/`**, and browser lanes don't touch
   `process/`. Fallout on the other side goes into the handoff.
5. **Lanes write code only.** Scoped `oxfmt` is allowed. Lint, typecheck and tests
   are run by the coordinator at collection.
6. **Every ruling lands in the record in the same commit.** The coordinator
   writes it, not the lane.

## Collection (coordinator)

Collect in wave order, and within a wave in lane number order.

1. `git diff --stat` on the manifest's owned paths: nothing outside them.
2. Scoped `oxlint`, the package's `typecheck`, and the package's tests.
3. Ratchet the baselines down: peer-cycle, core → enterprise, packages → features.
4. Boot check (the app installation tests).
5. `git commit --only <owned paths>`.

## Meters (report after each collection)

| Meter | Start | Target |
|---|---|---|
| Peer-cycle findings | 351 | 0 |
| Two-way pairs | 43 | 0 |
| Core → enterprise imports (non-test) | 69 | 0 |
| Packages → feature contracts | 20+ | 0 |
| browser-host declaration/drawer importers | 157 | 0 |
| workflow-api importers | about 98 | 0 |
| Lines in `ui-route-table.ts` | 947 | composition only |
| Uses of `defineServerModule` / `defineWebModule` | 83 / 51 | 0 |

## Lints to add first (coordinator, before W1)

Each ships at error with a frozen baseline that can only shrink:

- `packages/**` may not import `@langwatch/*-{contract,process,browser,browser-kit}`;
- `modules/**` may not import `@langwatch/enterprise-*`;
- the layer order from `catalogue.json` (add a `domain` field per module).
