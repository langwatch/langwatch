# The coordinator prompt: strict feature layout drive

The mechanism is now canonical elsewhere. How a coordinator runs a drive is
`.claude/coordinator/COORDINATOR.md`; how a lane is briefed, bounded and
handed over is `.claude/coordinator/LANE.md` (including the paste that starts
one) and the two templates beside it; the rules that bind every agent - no
whole-tree checks, no git writes, never a `.env`, scoped tests, ownership,
cost, prose style - are `.claude/skills/core/`. Nothing below restates them.
This file keeps only what is specific to the strict feature layout drive: what
the coordinator reads, what every manifest of this drive carries, the counters,
and the module queue.

## 1. Starting the coordinator

Start a fresh agent in this checkout, on branch `feat/strict-feature-layout-v0`,
and give it `.claude/coordinator/COORDINATOR.md` (the steps are in
`.claude/coordinator/README.md`). It does no module work itself: it writes
manifests, starts lanes, reviews what they return, commits slices, and reports.

For this drive it also reads, after the protocol:

```
dev/docs/plans/handover-2026-09-10.md   the north star, the counters, what is
                                        left by module
dev/docs/plans/lane-brief.md            the target shape per baseline row, the
                                        exemplars, and the drive's code rules
```

The drive-specific paste, added after the protocol's own:

```
You are the coordinator of the strict feature layout drive. Beside the
protocol, read dev/docs/plans/handover-2026-09-10.md and
dev/docs/plans/lane-brief.md. Every manifest you write for this drive names
dev/docs/plans/lane-brief.md under its read-only reference paths and carries
the drive's end shape (section 2 of dev/docs/plans/coordinator-prompt.md).
The counter line is `bash dev/scripts/shape-counters.sh`.

Start now: run the counters, say what is dirty, and spawn your first two
lanes.
```

## 2. What every manifest of this drive carries

Beside the template's sections, every manifest for a conversion task states:

- the end shape: `defineModule("<m>").withRepositories(...).withApp(<M>App).withTransports(...)`,
  `repositories/{prisma,clickhouse,redis,memory}` behind interfaces, flat
  `transport/*.rest.ts` and `transport/*.trpc.ts`, and one install line per
  module in the process door;
- that a conversion goes **straight to that shape** and never to an interim one;
- that `apps/api/src/app/api-production.composition.ts` never grows - it is
  being deleted by the install mechanic - so a new module's install line goes
  in the shared-file request, not in a lane's diff;
- the baseline rows the task closes, as `<module>|<rule>` keys, with the
  exemplar for each row from the table in `lane-brief.md` named under the
  read-only reference paths.

## 3. Counters

`bash dev/scripts/shape-counters.sh` is this drive's counter line. Post it the
way `COORDINATOR.md` section 10 asks: beside the previous line, with a verdict
of closer, same or further, and the dirty count first - a non-zero one is
committed or explained before anything else. Two flat ticks in a row means the
approach changes, not that the counters run again.

The dirty count includes the baseline registers, which are dirty by default;
the coordinator applies the rows a lane closed when it commits that lane's
slice (`COORDINATOR.md` section 6), never by letting the lane sweep them in.

## 4. Choosing tasks

Take them from the handover's tables, largest module first, and never two in
the same module at once (`COORDINATOR.md` section 2 is the rule; the queue is
the drive's). As of 2026-09-10 03:5x the queue is: trace REST families,
scenario REST families, experiment steps two to five, gateway REST families,
langy namespaces, governance, workflow, automation, and the persistence rows
for model-provider, project, scim and coding-agent.
