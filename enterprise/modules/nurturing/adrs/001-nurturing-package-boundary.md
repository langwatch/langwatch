# ADR-001: Nurturing learns from events and keeps its own copies

**Status:** Accepted (2026-09-29; amended 2026-11-11, 2026-11-17 (twice), 2026-11-19 and 2026-11-24)

**Behavioural contract:** [Nurturing](../specs/nurturing.feature)

**Related:** [ARCHITECTURE.md §9](../../../../dev/docs/ARCHITECTURE.md), a module reacting to a peer's event

## Context

Lifecycle signals to Customer.io and product milestones to PostHog were sent
from inside the modules that own each fact (billing, scenario, workflow, and
others), so every owner carried a peer on billing's nurturing surface. A pull
from the owners was tried and rejected (2026-09-29): nurturing is event driven.

## Decision

Nurturing is its own enterprise module and is event driven:

- It never reads another module's tables and never calls another module's
  `*Api` for a fact.
- Everything it needs arrives in the owners' events, through peer subscribers
  (`withPeerSubscriber`) and peer folds (`withPeerFoldProjection`), and is kept
  in nurturing's own tables.
- The events follow the existing conventions: each is declared in its owner's
  contract with a Zod schema, typed `lw.<module>.<fact>`, carries its tenant and
  `occurredAt`, and is parsed by that schema on arrival. Each copy is idempotent,
  except the trace-day counts (see Persistence).

An owner that pushes a fact may call `NurturingApi.recordSignal` with a signal
from one Zod discriminated union by kind; the command lands as an event on
nurturing's own pipeline, keyed by kind and source event, and nurturing's
subscriber sends it once.

**Amended (2026-11-19): copies are projections, filled at deploy.** Nurturing's
copies of the owners' facts are peer map projections on its
`nurturing_project_usage` pipeline, one per owner pipeline, and its plan copy is
a peer fold over billing's `subscription_changed` facts keyed by organization.
Each write is order-free and idempotent (a time keeps its earliest or latest, a
set only grows, a personal project's first owner stays), so a redelivered, late
or replayed fact leaves a row as live delivery would. A deploy step replays each
lane from its owner's log after the erasure-mark steps; the member, admin and
personal-project writes read the marks as the key copy does, so no replayed row
names a person erased before the copy existed. A replay never sends: it writes
the projection's store and runs no subscriber, and a map has none. The plan
fold's subscriber tells Customer.io a plan only on a fact's live delivery and
only when that fact won the fold, so a deploy replay fills the plan copy and
sends nothing, and a newer live or catch-up fact still sends. The fold commits
before the send; a refused send retries its own job, so a refused catch-up's
retry still sends again unless a fact that beats it landed first. The member
copy's history before organization recorded member facts comes from
organization's `member_listed` facts, recorded once by organization's own step;
the `nurturing-member-backfill` task is removed. An organization's evaluation
and run counts and coding columns stay subscriber-written, because each write
decides a send from the row before it.

**Amended (2026-11-24): trace days are a peer fold.** The trace-day counts are
two peer folds, one over trace's root spans and one over its failed traces, as
each event has its own owner pipeline. Both write `NurturingProjectTraceDayCount`
keyed by project, UTC day and source, so a replay rebuilds each day exactly
instead of adding to it; two deploy steps replay trace's log one counting window
back. This reverses the decision of issue 9378 that kept them a batch
subscriber. A span stored under two event ids still counts twice, as before.
During rollout, an old-pod batch that counted and then failed before its ack is
retried on a new pod through the lane alias, and counts twice until the replay
rebuilds that day.
`NurturingUncopiedProject` and its retry clock are retired: a fold counts a
trace whether or not its project's placement copy has landed. It and
`NurturingProjectTraceDay` are read and written by no code of this release (the
migration reads `NurturingProjectTraceDay` once to seed the new table), and stay
until an operator step drops them.

## Known exceptions on main, tracked

These reads predate the decision and are tracked in
https://github.com/langwatch/tasks/issues/1131:

- `process/src/repositories/prisma/prisma.nurturing-project-directory.repository.ts`
  reads the `Project`, `Team` and `Organization` tables for a project's
  organization, personal owner, first project, organization creation time and
  whether an organization has traced.
- `OrganizationApi.getAllMembers` and `OrganizationApi.organizationIdsForMember`
  in `process/src/services/nurturing-member-facts.service.ts`, and
  `OrganizationApi.getAllMembers` in
  `process/src/services/nurturing-coding-milestones.service.ts`.
- `UserApi.findById` in `process/src/services/nurturing-delivery.service.ts`, for
  a person's email and name when the signup is sent.

## Public surfaces and transports

Each package has one root export. Nurturing serves no route: the contract's
`NurturingApi` carries only `recordSignal`.

## Dependencies

The contract holds the signal union, the Customer.io vocabulary, the Api token,
the config (`CUSTOMER_IO_REGION`, the shared `POSTHOG_KEY`/`POSTHOG_HOST`
leaves) and the `CUSTOMER_IO_API_KEY` secret. The process imports the event
schemas of the owners it listens to, and the `UserApi` and `OrganizationApi`
contracts only for the exceptions above. Gateway's contract
(`@langwatch/gateway-contract`) is one of those owners: its
`lw.governance.vk_lifecycle` and `lw.governance.budget_crossing` facts carry who
created a key, who it acts for, its purpose and a crossing's period end, its
`lw.governance.vk_first_request` fact says a key served its first request, and its
`lw.governance.unbudgeted_spend` fact names an organization's top unbudgeted keys
by name and spend, so nurturing never reads gateway's tables
(https://github.com/langwatch/tasks/issues/1200). Governance's contract
(`@langwatch/enterprise-governance-contract`) is another: its
`lw.governance.ingestion_source_created` and `lw.governance.ingestion_source_went_live`
facts name an ingestion source's organization, id, type and creator, so nurturing
never reads governance's tables. No feature module depends on
nurturing's process, so no peer cycle can pass through it.

## Persistence

Nurturing owns its copies of the owners' facts: `NurturingProject` (a project's
organization), `NurturingOrganizationCreated` (an organization's creation),
`NurturingOrganizationMember` (memberships), `NurturingOrganizationPlan` (an
organization's plan, folded from billing's `subscription_changed` facts),
`NurturingVirtualKey` (a gateway key's organization, name, creator, holder,
purpose and state, folded order-free from gateway's `vk_lifecycle` facts by a
peer map, one statement a fact, which a deploy-time replay fills from gateway's
log),
`NurturingPersonalProject` (a personal project's owner) and `NurturingTracedProject`
(a project that traced).
It also owns `NurturingOrganization` (admin, milestone counts, coding signals,
last trace), `NurturingProjectUsageView` (one peer fold row per project and
owner), `NurturingProjectTraceDayCount` (trace and failure counts per project,
UTC day and source, kept 30 days) and `NurturingErasedUser` (a SHA-256 of each erased account's id, never
the id, so no member fact or gateway key fact folded after the erasure stores
them again, whatever its stamp; https://github.com/langwatch/tasks/issues/1204).
User ids are nanoids (~126 random bits), so a keyed hash (as governance uses for
guessable emails) isn't needed; the hashed `nurturing-erased-user:` prefix stops
joins with the bare SHA-256 a delivery claim key carries. The marks have one
repository, `NurturingErasedUserRepository`, whose memory twin every memory copy
of one composition shares. The member copy, the organization copy and the key
copy each write the mark through it before clearing their rows. A member or key
write re-checks the mark after it, so a fact whose write read no mark of an
erasure still committing leaves the person on no row; a worker stopping between
a write and its re-check leaves them until the fact is redelivered. The
re-checks give that guarantee; the mark checks inside the writes only shorten
how long such a row is briefly visible. The usage mirror drops a marked member
too, so such a row, or one from before the marks, gets no identify. An
organization row a late fact names a marked admin on keeps the id, but every
read of it names no admin, so no plan, usage or key send reaches them. Every
delivered signal drops a marked person before any send: one about them sends
nothing, and an organization's fact still reaches its other members; a guided
turn's failure and an organization's creation read the marks too. A member list
read from the owner (`getAllMembers`) does not read the marks: it relies on the
owner deleting the person's `OrganizationUser` and `User` rows in the same
transaction as the fact that records the erasure. Erasures from before nurturing
kept marks are marked at deploy by two replay steps, over user's `lw.user.erased`
and identity's `lw.identity.user_erased`, which run before the key copy's replay
so a replayed key names none of them. The mark is written by
nurturing's `userErased` subscriber, after the owner has committed the erasure:
until it runs, however long it lags or retries, a signal about the person still
sends, and an identify can recreate their Customer.io person, which nurturing
never deletes. After it, the marks are read before the send, not with it: a mark
written between that read and the send lets that one send out. Neither gap
closes outright, because an HTTP call cannot join the erasure's transaction. The
first can be shortened; this change does not shorten it. A key fact naming a
marked holder folds in as no holder at the fact's own stamp, clearing a holder
keeps their stamp, and a holder fact at a cleared holder's own stamp fills it,
so a key's holder is the person its latest-stamped holder fact names, or no one
if they are erased, whatever order the facts and the erasure arrive in, but for
one case: two holder facts at one stamp naming two people keep the one folded
first while neither is marked; if that one is erased later, the key has no
holder until the other person's fact at that stamp is redelivered. Erasure no
longer moves a cleared holder's stamp to now. A hand-over stamped between the
holder's stamp and the erasure, which was dropped, now lands. The race the moved
stamp closed is now closed by the re-check. A redelivered batch folds into the
trace days once, but a root span stored under two event ids counts twice, as
before (issue 9378).
Signals are events on the `nurturing` pipeline.
A delivered signal is claimed in Redis for seven days under the process-wide idempotency key prefix,
so a redelivered event sends nothing. A gateway key's creation, its first request, its
budget's crossings and an organization's unbudgeted spend are claimed per call, the identify apart from the track, so a retry after a refused call
sends only that call. Billing's catch-up `subscription_changed` fact, recorded by
the `customer-io-plan-resync` task, is never claimed. Every `subscription_changed` fact folds into
`NurturingOrganizationPlan` as ADR-174 decision 17 folds billing's facts: the newest billing fact
wins, and a real fact wins a tie. Customer.io hears a fact only when it changes that row, and the row is
written once the calls are sent, so a refused catch-up's retry sends again unless a fact that
beats it landed first.
**Corrected (2026-11-19):** the plan copy's row is written by the fold first, and
the plan send runs after it, from the fold's subscriber; a refused send retries
its own job and sends again unless a newer fact won the fold. Nurturing also owns
`NurturingProjectEvaluationDay` (evaluation days per project and UTC day). The
personal-project copy and the admin write also write and re-check the erasure mark.

## Runtime and registration

The Customer.io service and the PostHog client are built in `NurturingModule.create`
only when their key is set; the PostHog client is closed with the process. The
copies' maps and the plan fold always register. The per-project
usage folds, the trace counting, the usage sync and the founder's group call on an organization's
creation register only with a Customer.io channel. Owners
send the command in any role; the subscribers run in the worker. The founder's
call carries the name and creation time but no plan, so a replay or retry never
resets a paying organization's plan.
The one exception is the sign-up path, whose group call still sends plan "free" for a
brand-new organization, which has no paid plan yet; that call is claimed once per sign-up.

## Environment and configuration

Nurturing reads no ambient environment: its config and secret are declared in
the contract and composed by the apps.

## Errors

A sink failure is reported and swallowed, as main's fire-and-forget calls were.
A failed claim throws, and the subscriber is retried. A `subscription_changed`
fact is not swallowed either. A refused live one gives its claim back and fails
its job, so it is retried. A catch-up one fails its job on a refused call or on
no Customer.io channel (`no_customer_io_channel`), so it is retried or replayed
(https://github.com/langwatch/tasks/issues/1196). So does a gateway key's call
Customer.io refuses: its claim and the signal's are given back first
(https://github.com/langwatch/tasks/issues/1200).

## Contracts and validation

The signal union and the command are Zod schemas; the owners' events arrive
parsed by their own contracts' schemas.

## Consequences

A signal lags its fact by the owner's event and nurturing's subscriber. Each new
fact costs a peer subscriber or fold and, when it must be kept, a column or
table of nurturing's own. A copy is complete for everything its owner's log names; an
organization created before organization recorded `created` stays absent from
`NurturingOrganizationCreated`, and every window that reads it had already
ended.
