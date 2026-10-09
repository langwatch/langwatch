# ADR-003: An insight belongs to one person

**Status:** Accepted

**Behavioural contract:** [Insights inbox](../specs/insight-inbox.feature), rules
"An insight belongs to one person", "Filing an insight" and "Copying an insight".

## Context

ADR-001 made an insight the project's: every member with `analytics:view` read the
same inbox, and only seen, done and kept were personal. The owner of the product
decided otherwise. An insight is tied to the Langy that made it, and each person
steers their own Langy: what it looks at, when it runs, whether it runs at all. Two
people may get the same finding twice. That is accepted, because each of them stays
in control of their own inbox. Sharing is copying the text, for now.

## Decision

**One owner.** The filed event carries `ownerUserId`, and `InsightProjection` holds it
in a column of its own. For an insight saved from a chat the owner is the person who
saved it. Ownership is not read from `filedByUserId`: a scheduled run will file for a
named person with `filedByUserId` null and `filedVia` `run`, through the same command.

**Only the owner reads and acts.** The repository answers a reader the insights they
own and no others, in the list and by id. Mark seen, mark done, keep and restore go
through the same read first, so they are the owner's alone. The project permission
stays: every procedure still takes `analytics:view`, so an owner who lost it on the
project reads nothing there.

**Another person's insight answers as an unknown one.** The read by id carries the
owner in its `WHERE`, so another person's insight and an id no insight has take the
same path to the same `insight_not_found`. A separate "not yours" answer would tell a
member that a colleague's insight exists, and which ids are live. Marking seen skips
an id the caller does not own, as it skips an unknown id.

**Filing takes `analytics:view`, down from `analytics:manage`.** `manage` guarded a
write into an inbox the whole project read. A filing now writes a note only its
author reads, like marking seen or done, which already took `view`.

**The read limit is per owner.** One inbox read carries the owner's 500 newest
insights in the project. It was the project's 500 newest.

**One additive change, again.** `ownerUserId` has the default `null` on the filed
event's data schema, and the fold gives an insight with no named owner to whoever
filed it. The event version stays `2026-10-09`, as in ADR-002. The column is
nullable and nothing is backfilled: a row folded before it, or by an image that does
not know it, holds NULL, and the read treats that row as owned by `filedByUserId`.

**Copy is the sharing.** The row's Copy action writes plain text to the clipboard:
the title, the body, the fixed period with its values, and the board and widget as
filed. There is no link and no forward.

## Consequences

- `InsightReaderProjection` now holds one row per insight, its owner's. It stays a
  table of its own, so a later "forward to a person" can add readers without a
  migration. Rows that other members wrote while the inbox was shared stay in it
  and are never read.
- Until a scheduled run files insights, an owner has always seen their own: saving
  an answer marks it seen. The bell and the sidebar count stay at zero until then.
- The numbers in a copied insight are the ones Langy wrote into the body. Nothing is
  replayed for the copy, because an insight keeps what to run and never a result
  (ADR-002), and the replayed values live in the chart analytics lends.
- A read hint still goes to every member's open tab in the project when any insight
  event commits. It carries the procedure path and no data, and the refetch answers
  each caller their own insights. Scoping it to the owner is a contract change:
  `{ event, scope: "ownerUserId" }` on the filed event, `scope: "userId"` on the rest.
- Replaying the insight projection fills `ownerUserId` on old rows whose events the
  log still holds. Once every row has it, the read's NULL branch can go.
- A person who leaves the project keeps their rows, unread: the module removes
  nothing when a member leaves.
- Nothing limits how many insights a person files. The read limit bounds what one
  read carries, not what is stored.
