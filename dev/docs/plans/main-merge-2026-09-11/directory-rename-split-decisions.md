# The 14 directory rename splits, decided

Measured 2026-09-11 at `d5c2db2822`, merge base `105613d379`, against
`origin/main` at 86 commits ahead of the base.

The plan says these must be decided before any lane starts, because a lane cannot
make progress on one from its manifest alone. This is that decision.

## What they actually are

Every one of the 14 is in `platform/app/**` - the monolith this branch dissolved
into `apps/*`, `modules/*` and `enterprise/modules/*`. Main kept adding files to
it. Git cannot place those additions because the directory they belong to was
split across several destinations with no majority.

So this is not 14 unrelated decisions. It is **one policy and 14 placements**, and
five of the placements are empty.

The policy, from the plan's own rule: *main's change either lands somewhere, or it
is dropped with a stated reason.* A file main added is work someone did after the
fork. The split conflict is git saying "I do not know where this goes", never
"this is not needed".

## The table

`added` counts files main created under that path since the merge base, recursively.

| # | Split directory | added | Decision |
| --- | --- | --- | --- |
| 1 | `platform/app/ee/governance/services/__tests__` | 35 | governance port - see below |
| 2 | `platform/app/src/components/governance` | 96 | governance port - see below |
| 3 | `platform/app/ee/governance/dashboard/logic` | 5 | governance port - see below |
| 4 | `platform/app/ee/governance/__tests__` | 4 | governance port - see below |
| 5 | `platform/app/ee/governance/dashboard/logic/__tests__` | 2 | (inside #3) |
| 6 | `platform/app/src/server/app-layer/traces` | 4 | `modules/trace/server/src/**` |
| 7 | `platform/app/src/server/app-layer/traces/__tests__` | 1 | (inside #6) |
| 8 | `platform/app/src/tasks/__tests__` | 1 | `apps/tasks/src/**/__tests__` |
| 9 | `platform/app/src/utils/__tests__` | 1 | `apps/ui/src/features/personal-workspace/**` - verify first |
| 10 | `platform/app/ee/governance/services/department/__tests__` | 0 | **nothing to place** |
| 11 | `platform/app/src/components/agents/connected/__tests__` | 0 | **nothing to place** |
| 12 | `platform/app/src/components/scenarios/utils` | 0 | **nothing to place** |
| 13 | `platform/app/src/server/app-layer/langy/execution/__tests__` | 0 | **nothing to place** |
| 14 | `platform/app/src/server/app-layer/langy/streaming` | 0 | **nothing to place** |

**Five of the fourteen (10-14) decide themselves.** Git is confused about a
directory main did not add to. Take the branch's side and record it; there is no
work behind them.

## The four small ones

| File main added | Where it goes |
| --- | --- |
| `traces/span-ingestion-tally.ts` + its test | `modules/trace/server/src/services/` |
| `traces/trace-ingestion.metrics.ts` | `modules/trace/server/src/services/` - the branch already has `modules/trace/specs/trace-ingestion-metrics.feature`, so the spec is here and the implementation is what is arriving |
| `traces/repositories/__tests__/trace-list.clickhouse.repository.unit.test.ts` | `modules/trace/server/src/repositories/clickhouse/__tests__/` |
| `tasks/__tests__/provisionLwql.redaction.unit.test.ts` | `apps/tasks/src/**/__tests__/` - `provisionLwql` has one content hit on the branch, a ClickHouse migration, so confirm the task still exists before placing its test |
| `utils/__tests__/personalProject.unit.test.ts` | `personalProject` has 53 content hits; the concept lives as `personal-workspace`. Read the test and place it with whatever it actually asserts |

**`spanIngestionTally`, `inventorySummary`, `sourceHealthDisplay` and
`confirmArchiveSource` have zero content hits on this branch.** They are main's
new work, not renamed branch work. There is nothing to match them against, so
they are placed by what they do. Do not read a zero hit as "no longer needed".

## Governance is not a split decision, it is a port

Items 1 to 5 are **140 files**. They do not belong in the merge lanes with
everything else, for a reason worth stating plainly.

Main's additions under `components/governance` group as:

```
costs 22   agents 15   people 13   __tests__ 10   filters 7
summary 5  sync 4      sample 4    platform 4     home 4     empty 3
```

The branch's `enterprise/modules/governance/web/src/features` holds:

```
ai-tools   departments   ingestion-sources   ottl   overview   source-events
```

Those two lists barely intersect. Main built a governance dashboard - costs,
agents, people, filters - that this branch's governance module does not have, and
the branch built a governance module around ingestion and departments that main
does not have. This is the one area where the two sides genuinely diverged in
what the product does, rather than where its files live.

So: **one Opus lane, on governance alone, after the merge commits.** It is a port
of a feature, and pretending it is a rename resolution is how 140 files get
"resolved" by taking ours.

## What this unblocks

Items 6 to 14 can be resolved by any lane holding the area, with the table above
in its manifest. Items 1 to 5 come out of the merge entirely and become their own
task, which also removes the largest single source of judgment from the merge
lanes.
