# .claude/coordinator/

The multi-agent workflow for this repository: a coordinator, a small number of
bounded lanes, and two documents passing between them.

This directory is **tracked** - it is the protocol. The instances it produces,
under `.claude/manifests/` and `.claude/handoffs/`, are runtime state and are
ignored.

## The shape

```
Coordinator                                  Lane
  writes a manifest          ---------->       reads manifest + handoff
  starts <= 3 lanes                            edits ONLY owned paths
  waits on events                              runs scoped checks
  reads handoff, then diff   <----------       rewrites handoff, stops
  owns shared-file changes
  commits one coherent slice
  starts a FRESH lane, never a resumed one
```

## The files

| File | What it is |
| --- | --- |
| `COORDINATOR.md` | Instructions for the coordinating agent |
| `LANE.md` | Instructions for a lane, including the paste that starts one |
| `manifest-template.md` | The task contract, written before a lane starts |
| `handoff-template.md` | The snapshot, rewritten before a lane stops |

Shared rules the whole protocol depends on live once, in
`.claude/skills/core/` - repository rules, testing rules, handoff rules. Nothing
here restates them.

## Starting a run

1. Start an agent and give it `COORDINATOR.md`.
2. It writes `.claude/manifests/<task-id>.md` per task, from the template.
3. It starts each lane with the paste in `LANE.md`, passing the model the
   manifest names.
4. Lanes write `.claude/handoffs/<task-id>.md` and stop.
5. The coordinator reads, reviews, applies shared-file lines, commits the slice.

## The four decisions this encodes

**Event-based checkpoints, not a timer.** The coordinator acts when a lane
completes, blocks, fails a check, breaks the boot, reaches its budget, or needs a
shared file. It does not poll because time passed. A `/loop` tick that finds
nothing changed still pays for the whole context.

**Three lanes by default.** More needs a stated reason and ownership lists
checked not to intersect. The ceiling is the coordinator's review capacity, not
the machine's.

**A fresh lane, never a resumed one.** A resumed agent re-pays its whole history
on every turn, so cost is quadratic in turns. The handoff exists to make the
fresh start cheap.

**The cheapest suitable model, enforced at spawn.** The manifest's `Model:` line
is advisory until the coordinator actually passes it. A lane that finds a real
architecture decision stops and records it rather than guessing.

## Relationship to dev/docs/plans/

`dev/docs/plans/` holds the *content* of a drive - what is being migrated, the
counters, the module queue, the design. It keeps that role.

This directory holds the *mechanism* - how agents are briefed, bounded and
handed over, for any drive. `dev/docs/plans/coordinator-prompt.md` and
`dev/docs/plans/lane-brief.md` were the first version of this mechanism, mixed
in with the strict-feature-layout drive's content; they now point here for the
mechanism and keep only what is specific to that drive.
