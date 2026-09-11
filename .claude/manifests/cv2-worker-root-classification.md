# Manifest: cv2-worker-root-classification

Objective: Settle whether `dev/docs/plans/worker-composition-proposal.md` stands
or needs rewriting, by classifying every construction in the worker's production
composition root. This is an **analysis lane**. It changes no source file.
Owner: unassigned
Model: sonnet, medium-high effort, standard context - bounded classification
against a rubric this manifest supplies. Not architecture: you classify, the
coordinator decides.
Budget: 45 tool calls
Handoff: .claude/handoffs/cv2-worker-root-classification.md

## Why this exists

The proposal claims the worker's composition roots are 13,725 lines because
modules make their callers build their collaborators, and that a shrink-only
ratchet on 184 bespoke fields is therefore the play. That claim rests on one
number nobody has checked: that the constructions in
`apps/worker/src/app/worker-production.composition.ts` are **mostly** building
things the module should own.

If they are, the proposal stands. If most of them are genuine process wiring,
the headline is wrong and the proposal is rewritten before anyone acts on it.

You are not being asked whether the proposal is good. You are being asked for
three counts and the evidence behind them.

## Owned paths

```
.claude/handoffs/cv2-worker-root-classification.md
```

That is the whole list. **You write no source file, no test, no document.** If
you find a bug, record it under `Risks`; do not fix it.

## Read-only paths

```
apps/worker/src/app/worker-production.composition.ts     THE SUBJECT
apps/api/src/app/api-production.composition.ts           the converted contrast, 183 lines
modules/trace/server/src/app/trace.members.ts            the largest bag, 29 fields
modules/gateway/server/src/app/*.members.ts              a converted module for contrast
dev/docs/plans/worker-composition-proposal.md            the claim you are testing
.claude/skills/architecture-guide/references/composition-by-size.md   what a root is allowed to contain
```

## The rubric

Every `new X(...)`, `createX(...)`, `makeX(...)` and factory call in the subject
file goes in exactly one bucket:

- **(a) bag construction** - it is built in order to be handed to a module as a
  field of a `<Module>Infrastructure` / `<Module>Members` object, or passed into
  `withInfrastructure`/`membersFrom`. Trace it to where it lands.
- **(b) module-owned collaborator** - a repository, channel, service, mapper,
  normaliser or client that names exactly one module's domain and has no other
  caller. It would be legal inside that module today.
- **(c) genuine process wiring** - one of the fourteen canonical members
  (`logger clock secrets encryption telemetry prisma clickhouse objectStorage
  redis cache idempotency rateLimiter eventing mail`), a queue or scheduler the
  process itself owns, a shutdown hook, a health endpoint, or config mapping.

A construction that is genuinely ambiguous goes in a fourth bucket, **(d)
unclassifiable**, with one line saying what made it ambiguous. Do not force a
judgement to make the numbers tidy - (d) being large is itself a finding.

## Method

1. **Re-derive the count first.** The figure 153 came from one grep by the
   coordinator and may be wrong. Get your own total and say what pattern produced
   it. If your total differs from 153, that discrepancy is the first line of your
   handoff.
2. `tslsp-cli outline` the file before reading any of it. Read ranges, not the
   whole 2,530 lines.
3. Classify. For bucket (a) you must show where the thing lands - a construction
   is only (a) if you traced it into a bag.
4. Count lines as well as constructions: how many of the file's 2,530 lines sit
   inside (a)+(b) regions versus (c). Constructions and lines can disagree, and
   the proposal's headline is about lines.

## Invariants

- No file outside your owned path is written, renamed or deleted.
- No git writes of any kind.
- No whole-tree checks. You are not running `pnpm typecheck` at all - you change
  no code, so there is nothing to check.
- Numbers are counted, never estimated. "Roughly half" is not an answer; 71 is.
- If the rubric does not fit what you find, say so and stop - do not invent a
  fifth bucket and carry on. That is an architecture decision and it is the
  coordinator's.
- British English, no em dashes - write " - " instead.

## Checks

None to run. Your evidence is the classification itself. What makes it checkable:

- the four buckets sum to your re-derived total, exactly;
- every (a) names the bag it lands in;
- the line counts sum to 2,530 or you say what the remainder is.

## Stop conditions

- the rubric does not fit and a fifth category is needed;
- the file's real construction count differs from 153 by more than about 20,
  which would mean the coordinator's premise is wrong and the manifest needs
  rewriting around the real number;
- the budget is reached - hand over a partial classification with the buckets
  counted so far and the line number you stopped at.

## Completion criteria

- Four bucket counts that sum to your re-derived total.
- The line split between (a)+(b) and (c).
- For the largest five constructions by line count, one line each saying which
  bucket and why.
- A one-line statement of which way the evidence points: mostly bag-and-module,
  or mostly process wiring. **State what you found, not what should be done
  about it.**
