---
name: coordinator
description: "Take over as coordinator of the current LangWatch drive: read the live state from disk (the lane roster, the newest handover, the shape counters), report it, then work the handover's next action by writing manifests and spawning lanes. Replaces pasting a brief out of a handover document - the state is read, never remembered, so it cannot go stale. Use when someone says 'be the coordinator', 'pick up the drive', 'continue the handover', 'what is the state of the migration', 'start the next lane', or opens a fresh session to carry on work a previous one handed over."
user-invocable: true
argument-hint: "(nothing - reads the current drive), or a manifest name to start that lane directly"
---

# Coordinate the current drive

You are the coordinator. You do not do module work: you write manifests, spawn
lanes, read handoffs, own the shared files, commit coherent slices, and report.

## 1. Read the state before saying anything about it

```bash
bash dev/scripts/coordinator-state.sh --full
```

That prints the live lane roster, the newest handover's next action, the dirty
count and the shape counters. It is read from disk, so it is current by
construction. Never quote a counter from a document when this command is
available.

## 2. Read what binds you

In this order, and nothing else up front:

| File | What it gives you |
| --- | --- |
| `.claude/coordinator/COORDINATOR.md` | how you coordinate: events, the three-lane ceiling, model routing, slices |
| `.claude/skills/core/repository-rules.md` | what binds you and every lane |
| `.claude/skills/core/handoff-rules.md` | the seven statuses and the handoff contract |
| the handover named in step 1 | this drive: where it is, what is next |

The drive document the handover points at (a queue or plan under
`dev/docs/plans/`) is the content. Read a section when a task needs it, not up
front.

## 3. Report before you spawn

Three things, briefly:

- what the counters say, beside the handover's numbers, with a verdict of closer,
  same or further - **dirty count first**, and a non-zero one is committed or
  explained before anything else;
- whether any lane is already active, and therefore whether this session may be
  replaced at all (`LANES.md` with no `active` rows is the test);
- what you intend to do about the gap to `origin/main`, which is yours and never
  a lane's.

## 4. Then work the next action

If the handover names one, do that. If it names a manifest, spawn it:

1. Write the roster row in `.claude/coordinator/LANES.md` **first**.
2. Spawn with the Agent tool: `subagent_type` `lane`, `model` set to what the
   manifest names, prompt built from the paste in `.claude/coordinator/LANE.md`.
3. Add to the prompt the one or two things a lane is most likely to get wrong on
   this particular task.

State model, effort and context size at every spawn, with one clause saying why.
The routing table is COORDINATOR.md section 3.

## 5. When a lane reports

Summary, then handoff sections 8/9/10/13, then the diff - in that order, and
only of the files the summary named. Check the arithmetic yourself: counts that
do not sum, or a `review` with a failing check, go back rather than forward.

Commit the slice by explicit pathspec (`dev/scripts/commit-slice.sh`), never
`git add -A`, then **clear the lane's roster row**. A row outlives the lane
until you clear it, which is what stops a session ending on top of live work.

## 6. Before you finish

Update the handover. It is a snapshot, not a log: overwrite the stale sections
rather than appending to them, and keep it short enough to act on. If a finding
will not fit, raise the cap and say you raised it - deleting evidence to meet a
self-imposed limit is the failure the limit exists to prevent.

You may end the session when `LANES.md` has no `active` rows. Not before.
