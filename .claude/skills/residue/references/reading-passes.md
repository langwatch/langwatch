# Reading passes

What the import graph structurally cannot know, and how to confirm a lead before it
becomes a finding. Do these after `dev/scripts/find-residue.mjs` has run, in this order —
pass 1 is the one worth your time.

---

## Pass 1 — Two generations of one job

The highest-value residue is not dead. It is **alive, alongside its replacement**, and no
detector will name it because both generations are reachable, compile, and pass tests.

The tell is a set of sibling files whose names are variations on a single noun. In this
repository the boot path is where it concentrates: `main`, `entrypoint`, `entrypoint.main`,
`executable`, `runtime`, `process`, `lifecycle`, `signals`, `listener` — ten spellings of
"how this process starts".

```bash
ls apps/api/src/*.ts apps/worker/src/*.ts
```

Then ask the only question that settles it: **which one does the package actually launch?**

```bash
node -e "console.log(require('./apps/api/package.json').scripts)"   # start / dev name the real entry
```

Trace forward from that entry by hand. Everything in the family that the trace never
reaches is a previous generation. Confirm with the detector's `test-only` and `orphan`
lines, which will usually have flagged the leaf of the dead branch even when the trunk
looks live.

**Sibling asymmetry is the same tell at folder scale.** Two applications that do the same
job in different shapes means one of them did not get moved. Compare like with like:

```bash
ls apps/api/src/app/ | wc -l          # composition files
ls apps/worker/src/app/ | wc -l
```

A 1-versus-60 split is not a style difference. It is a migration that reached one
application and stopped. Check whether the repository already knows:

```bash
grep -o '"crowded-folder|[^"]*"' packages/architecture-enforcer/src/source-folder-shape-baseline.json
```

A `crowded-folder` entry is the shape drive's own note that this folder was left behind.

---

## Pass 2 — The baseline as the last mourner

When a file is genuinely dead, the last thing in the repository referencing it is often a
**lint baseline entry** — a recorded violation in a file nobody runs. That entry is doing
real harm: it makes the file look accounted-for.

For any file you suspect, grep its basename across the whole tree and read *what kind* of
thing is left holding it:

```bash
grep -rn "worker-trace-app" --include='*.ts' --include='*.json' --include='*.mjs' \
  apps packages modules enterprise dev | grep -v node_modules
```

If every surviving hit is a baseline, an allowlist, or a generated report, the file is
dead and the baseline entry should go with it. Say both things in the finding.

The mirror image is `dangling-guard`: a policy reading a baseline that no longer exists
enforces nothing while presenting as a guard. Both are the same defect from opposite ends.

---

## Pass 3 — Migrations announced and abandoned

A refactor that stopped usually left a sentence saying it was in progress.

```bash
grep -rn -iE '\b(for now|until we|temporarily|will be removed|to be removed|old implementation|first pass|step 1 of)\b' \
  --include='*.ts' --include='*.tsx' apps modules packages enterprise | grep -v node_modules
```

Read the code under each one and ask whether the promised second step happened. Most did
not; that is the point. `legacy` and `deprecated` are too common here to grep usefully on
their own — reach for them only inside a scope you are already reading.

Treat a comment describing behaviour the code does not implement as its own finding.
CLAUDE.md is explicit: delete the misleading comment or implement what it promises.

---

## Pass 4 — Drives that stopped

Residue is produced by work that was interrupted. This repository records interruptions
directly, and the records outlive the work:

```
.claude/manifests/     one file per bounded lane task
.claude/handoffs/      one file per lane that stopped and handed over
dev/docs/plans/        longer-lived drive plans
```

Read the newest handovers for the scope you are sweeping. A handover whose "next action"
was never taken points straight at half-converted code, and names it better than any
detector can. A manifest for a task that shipped is itself residue once its lane is done.

---

## Pass 5 — Specs that enforce nothing

A scenario binds nothing until it is tagged **and** annotated. CLAUDE.md states the trap
plainly: `check-feature-parity.ts` counts only scenarios carrying `@unit`, `@integration`,
`@e2e` or `@regression`, so an untagged `.feature` file reports `0/0 scenarios bound` and
`✓ all bound` — reading green while binding nothing at all.

```bash
# feature files that carry no binding tag and no exemption: green, and vacuous
for f in $(find specs -name '*.feature'); do
  grep -qE '@(unit|integration|e2e|regression|unimplemented)' "$f" || echo "$f"
done
```

An `@unimplemented` scenario is a promise with a date on it. In bulk they are the residue
of a spec-writing pass that outran the implementation. Report the count for your scope and
name the oldest few; do not list hundreds.

---

## Confirming a lead

Never report one of these without running the matching check. The evidence line in the
report is the command and its result.

| Detector | Confirm by |
| --- | --- |
| `orphan` | Grep the basename tree-wide (pass 2). Then check it is not reached by string: `grep -rn "<basename>" --include='*.yml' --include='*.json' --include='*.sh' .github dev charts`. A file loaded by path, glob, or spawn is not an orphan. |
| `test-only` | Open the one test that imports it. If the test only exercises the module's own surface and nothing else in the tree calls it, both are residue and they go together. If the test is a real contract test for live behaviour, the import graph is wrong — say so. |
| `re-export` | Read the forwarded names and find their real consumers. If the consumers already import from the new address, the shim is unused; if they still import from the shim, the finding is "the move was never finished", and the fix is to update them, not to delete. |
| `twin` | Find which spelling the package's entry publishes, then which one new code actually imports. The unpublished, unimported one is the previous generation. If both are published and both are used, it is not residue — drop the lead. |
| `slack-ratchet` | `grep -c '[^[:space:]]'` the file and compare to the stored budget. Report the slack as "may regrow N lines silently", because that is the actual risk. |
| `dangling-guard` | `ls` the baseline path the policy names. Then check whether the policy is registered and running at all — a guard reading nothing may also be wired to nothing. |

## When a lead dies

Say so, in the report, by name. "`X` looks orphaned but `charts/y.yaml` loads it by path"
is worth as much to the next reader as a confirmed finding, because it stops the same
lead being re-investigated next quarter. The detector cannot learn; the report is where
that knowledge goes.
