# Composition v2: the task queue

The drive's content. The mechanism it runs on is
`.claude/coordinator/COORDINATOR.md` and `.claude/skills/core/`; nothing here
restates it.

The design is `composition-v2.md` and ADR-144. This file is only the queue: what
is next, in what order, who may run in parallel, and which manifest holds each
task's contract.

## State, measured at a08cbd27b8 (2026-09-11)

`bash dev/scripts/shape-counters.sh`:

```
dirty=188  legacy_files=9  modules_on_legacy=3  feature_shape_rows=0
families_declared=80  families_unbound=47  ports_adapters_files=43
port_names=31  port_word_files=87  main_unfolded=83  api_boot=no-stack
```

Read them correctly - two are easy to misread:

- **`feature_shape_rows=0`.** The feature-shape conversion drive is **finished**.
  The baseline is empty. Any brief still describing that drive as the work is
  stale; this queue replaces it.
- **`main_unfolded=83`** is `git rev-list --count HEAD..origin/main`. It is not a
  task - it is this branch being 83 commits behind `origin/main`, and it grows on
  its own. Decide deliberately when to take it; it is not lane work.
- **`families_unbound=47`** is the count of `*/transport/*.rest.ts` files that
  still call `withMiddleware(`. It falls as a by-product of T3, not by its own
  task.
- **`api_boot=no-stack`** means the stack is not running, so no lane can check a
  boot log. Bring it up (`make haven up`) before starting lanes, or accept that
  the "read `haven logs backend`" step in every brief is a no-op.

## The shape of the queue

```
   T1 application.ts onto the member record        <- BLOCKS EVERYTHING
        |
        +-- T2 the peer seam (withProvided's replacement)
        |         |
        +-- T3 the REST credential object -----+
                                               |
                                     T5 per-module conversion, 3 at a time

   T4 the port word              runs NOW, independent of all of the above
```

**Do not start per-module conversion until T1, T2 and T3 have landed.** The plan
is explicit about why: annotation and api-key both converted and both stopped at
the same wall. Every other module would stop at that same wall, and you would
have paid for the discovery once per module.

## The tasks

| # | Task | Manifest | Model | Depends on |
| --- | --- | --- | --- | --- |
| T1 | `application.ts` onto the member record | `.claude/manifests/cv2-application-member-record.md` | opus | - |
| T2 | The peer seam - **verify the premise first, see below** | `.claude/manifests/cv2-peer-seam.md` | opus, then sonnet | T1 |
| T3 | The REST credential object on a route | `.claude/manifests/cv2-rest-credential-object.md` | opus | T1 |
| T4 | Delete the `port` word | `.claude/manifests/cv2-port-word.md` | sonnet | - |
| T5 | Per-module conversion | one manifest per module, from the recipe | sonnet | T1, T2, T3 |

### T1 - the one that matters

`packages/runtime-composition/src/application.ts` is still built around `Tier`
(`"live" | "memory"`) and `Infrastructure`. `@langwatch/infrastructure` is built
to ADR-144's member record. **The two have never been connected**, and
`persistenceFor(pool)` - inferring the backend from whether a Prisma client
happens to exist - is precisely the inference ADR-144 decision 2 refuses.

Until this lands, no converted module can delete its
`apps/api/src/features/<m>/` directory, which is the point of converting. This
is the critical path and it is architecture work: Opus, one lane, nothing else
running in the same files.

### T2 - its premise is stale, check before designing

`composition-v2.md` finding 2 says `withProvided` "is gone from
`ApplicationBuilder` and nothing replaces it, so 193 call sites across 62 `.ts`
files name a method that no longer exists".

**It is not gone.** Measured at `73d4fdb67d`, `withProvided` is defined at
`packages/runtime-composition/src/application.ts:355`, takes a token and an
instance, and 112 call sites across 36 files use it - all of which resolve.

So before opening an Opus lane for a peer seam, establish what is actually
missing. It may be nothing, in which case T2 disappears and T3 stops waiting on
it. If something is missing, it is narrower than the finding claims and the
manifest needs rewriting around the real gap rather than around a removed method.

This is the second stale claim found in the 09-10 documents (the first was 551
ports/adapters files against a real 31). Measure before you design from either.

### T5 - the per-module recipe

`composition-v2.md` section "Per-module conversion recipe" is the procedure, with
the corrections from annotation and api-key already folded in. The coordinator
writes one manifest per module from it, three modules at a time, never two lanes
in one module.

Two findings the recipe records that a lane must **state rather than discover**:

- an audit action must be dotted lower kebab (`management.api-key.read`, not
  `management.apiKey.read`), and the runtime writes a row for a refusal where the
  old mount-side middleware wrote one only after a 2xx. That widening is a
  declared delta, not a bug;
- a module's App must not declare its services' own seams. An interface belongs
  in the service file that answers it, or `verbatimModuleSyntax` refuses the
  cycle.

Pick as the **first** converted module one that genuinely reads a member (a
mailer, a cache). Finding 6 records that neither annotation nor api-key reads
one, so nothing in the tree yet proves `reads(...)` in anger - only its type.

## Before the first lane starts

1. `make haven up`, so `haven logs backend` means something.
2. Decide what to do about the 188 dirty files and the 83-commit gap to
   `origin/main`. Both are the coordinator's, not a lane's, and a lane starting
   on top of 188 dirty files cannot tell its own work from anyone else's.
3. Read `.claude/coordinator/COORDINATOR.md`. Start lanes from the paste in
   `.claude/coordinator/LANE.md`, passing the model the manifest names.

## Starting the coordinator

Paste this into a fresh session in this worktree. It is the whole brief - the
mechanism is in the files it names, and this drive's content is in this one.

```
You are the coordinator of the composition v2 drive, working in
/Users/afr/Source/github.com/langwatch/langwatch on the current branch. Work in
this checkout. Do not create a worktree, do not switch branch, do not push.

Read these, in order, and treat them as your instructions:
  .claude/coordinator/COORDINATOR.md          how you coordinate
  .claude/skills/core/repository-rules.md     what binds you and every lane
  .claude/skills/core/handoff-rules.md        the seven statuses, the handoff contract
  dev/docs/plans/composition-v2-queue.md      THIS DRIVE: the state, the queue, the order

The design behind the queue is dev/docs/plans/composition-v2.md and
dev/docs/adr/144-declarative-process-composition.md. Read a section of either
when a task needs it, not up front.

Start by doing three things and reporting before you spawn anything:

  1. Run `bash dev/scripts/shape-counters.sh` and say what moved since
     a08cbd27b8 (the numbers are in the queue document).
  2. Say what you intend to do about the 188 dirty files and the 83-commit gap
     to origin/main. Both are yours, not a lane's.
  3. Say whether the stack is up, since api_boot=no-stack means no lane can
     check a boot log.

Then spawn T1 (.claude/manifests/cv2-application-member-record.md, opus) and,
if you want a second lane, T4 (.claude/manifests/cv2-port-word.md, sonnet).
T4 is the only task independent of T1. Do NOT start per-module conversion
until T1, T2 and T3 have landed - the plan says why, and it cost two modules
to learn it.
```
