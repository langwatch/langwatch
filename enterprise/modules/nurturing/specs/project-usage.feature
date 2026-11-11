Feature: Per-email usage reaches Customer.io from nurturing's own project rows

  Nurturing folds the owners' prompt, evaluator, scenario and simulation-run events into its own
  table (peer folds, ARCHITECTURE §9). A peer fold re-folds from one owner's event log, so there
  are four folds, one per owner pipeline, each keeping its own row per project. Evaluations add
  their UTC day to one more row per project, at most once a day. Traces are counted by a peer
  subscriber on trace's span_received, which queues root spans only: a root span is one trace.
  Failed traces are counted from trace's own lw.trace.trace_failed fact, recorded once per trace
  by trace's rule (any span's error), so nurturing keeps no copy of that rule. Sample and Langy
  traces are left out, as trace leaves them out of a project's first trace. Root spans and failed
  traces of one project and day are batched, and each batch counts its traces once each in one
  Postgres statement: a row per counted trace and kind (NurturingProjectCountedTrace) is inserted
  unless it exists, and only the rows inserted are added to that day's row, so a trace stored in
  two versions, a redelivered batch or a redelivered trace_failed counts once (issue 9378 AC 3).
  Traces are counted only while their organization is inside its counting window (its creation
  plus the 14-day free window and a week), so the per-trace rows scale with new organizations'
  traffic alone. An hourly sweep (a scheduled process, since an organization that stopped tracing
  syncs no more) sends each organization's trace traits once as null when its window ends, so
  Customer.io removes them and a rolling trait never says "active" for ever; later syncs leave
  them out, and its trace rows are dropped. Nurturing's placement copy is written by its own
  subscriber, so a new project's first traces can arrive before it: for a project without a copy
  the batch fails and the queue retries it, while each attempt starts inside a five-minute retry
  window (the measured lag is seconds), until the copy lands. The first attempt at or past the
  window checks the copy one last time; still uncopied, the trace is dropped and the
  project is remembered in a bounded per-process set, so its later batches are dropped at once
  with no retry; the copy is always read first, so a copy that lands later counts the project
  again. A placed project whose organization has no creation copy belongs to an
  organization created before the copy existed: its traces are dropped at once, as such
  organizations get no trace traits. Nothing else is read. Rows are kept 30 days: inside its
  counting window no organization has an older one, so a sync deletes old rows only past it. No span body reaches nurturing, and the rows are not rebuilt by a projection replay.
  Nurturing reads no trace data: trace counts start at the count's deploy, and no cost is sent (a
  span carries no price). When a project's usage changes, or its organization traced (throttled
  to once per 15 minutes, and only inside the counting window), nurturing places it in its organization from its own copy, written
  from project's lw.project.created, sums the organization's projects and sends their traits to
  Customer.io as one group call on the admin. The onboarding emails are person-triggered and read
  person attributes, so the same sync then identifies each member with the same traits, unless
  the member has joined another organization since: a member's traits are those of the
  organization they joined last. Members come from nurturing's own copy (NurturingOrganizationMember),
  written from the owners' member facts: a join by organization's lw.organization.signed_up,
  lw.organization.invite_accepted or lw.organization.created naming its founder, or auth's
  lw.auth.sso_auto_added, a leave by
  lw.organization.member_removed or member_disabled, a return by member_enabled. Each keeps its
  latest time, so a redelivery or a late fact changes nothing; "joined last" is the latest join
  time in the copy. A member who joined before the copy existed is not in it. User's
  lw.user.erased deletes every membership of the account (with the other rows naming it,
  project-facts-copies.feature); a member fact delivered after the erasure writes a row again.
  On a usage sync a failed identify is reported and swallowed, as the
  other sinks' failures are; the group call stands. At a window's end it fails the sweep, which retries. A project's first trace syncs as later ones do. The
  signup day comes from its own copy of
  lw.organization.created. It reads no other module's table and calls no other module's API for
  a usage fact, and keeps no copy for projects or
  organizations created before it did: those send nothing. It never pulls owner state on a
  schedule, and sends counts and times only, never content. flagged_count waits on its
  definition. Without a Customer.io channel no fold, trace count or sync is registered: nothing is
  counted. The placement, organization-creation and member copies always register, so a channel
  configured later finds them already kept.

  @unit
  Scenario: Every owner event becomes the fact its fold counts
    Given an owner event: prompt created, version saved or deleted, evaluator created or deleted, scenario created, simulation set created, or simulation run finished
    When nurturing reads it
    Then it becomes the matching prompt, evaluator, scenario, simulation-set or scenario-run fact at the event's time

  @unit
  Scenario: A fact without a project id is counted on its tenant
    Given a simulation run finished, whose data names no project
    When nurturing reads it
    Then the fact is counted on the event's tenant, which is its project

  @unit
  Scenario: Each owner's fold turns its event into the project's row
    Given each owner's peer fold
    When it folds one of its owner's events
    Then the row is keyed by the event's project and counts what the event says

  @unit
  Scenario: Prompts and evaluators count up when created and down when deleted
    Given a project's fold has taken two prompt.created and one prompt.deleted for another prompt
    And one evaluator.created and its evaluator.deleted
    Then the project counts 2 prompts and 0 evaluators

  @unit
  Scenario: Each simulation set counts once
    Given simulation_set.created arrives twice for one set and once for another
    Then the project counts 2 simulation sets

  @unit
  Scenario: Prompt versions, scenario runs and evaluations mark their UTC day active
    Given a project saves a prompt version, finishes a scenario run and completes an evaluation
    Then each fact's UTC day is in the project's active days once
    And days older than 30 days before the newest fact are dropped

  @unit
  Scenario: Creating a prompt counts the prompt but marks no day active
    Given a project creates a prompt on a day with no other activity
    Then the project counts the prompt
    And that day is not in the project's active days

  @unit
  Scenario: A project's evaluation days are written one at a time
    Given evaluations of one project on two UTC days, taken at once
    When nurturing adds their days to the project's evaluation row
    Then they run one after another in the project's lane, so the row keeps both days

  @unit @integration
  Scenario: Evaluations mark a project's day once
    Given several evaluations of a project complete on the same UTC day
    Then the project's evaluation row holds that day once
    And later evaluations that day write nothing

  @unit @integration
  Scenario: A trace is its root span, counted on its project's day
    Given root spans of a project's traces appended on one UTC day
    When the trace-day count takes them
    Then each adds one trace to the project's row for that day
    And a root span appended on the next UTC day counts on the next day's row

  @unit
  Scenario: Only a root span mints a trace-day job
    Given a trace's root span and its child spans
    When trace appends them
    Then only the root span is queued to the trace-day count, so a child span costs no job

  @unit
  Scenario: Sample and Langy traces are not counted
    Given root spans whose langwatch.origin, on the span or else its resource, is sample or langy
    When trace appends them
    Then none is queued to the trace-day count, as trace keeps them out of a project's first trace
    And one already queued is not counted
    And a root span of any other origin, or none, is queued
    And a trace_failed of a sample or Langy trace counts no failed trace

  @unit
  Scenario: A failed trace is counted from trace's trace_failed fact
    Given trace records trace_failed for a project's trace, by its own rule
    When the failed-trace count takes it
    Then the project's day of the fact counts 1 failed trace, and its time
    And a root span's error status alone counts no failed trace

  @unit
  Scenario: A redelivered trace_failed counts its failure once
    Given trace_failed for a project's trace, delivered again under a new event id
    When the failed-trace count takes each delivery
    Then the trace counts one failed trace, its counted row keyed by project, trace and kind

  @unit
  Scenario: A failure on the day after its trace's root span still counts
    Given a project's trace counted on one UTC day and its trace_failed appended on the next
    When the organization's traits are built
    Then error_count counts the failure, and its day is an active day

  @unit
  Scenario: Traces arriving out of order count the same
    Given two traces' root spans of one project and day, the older arriving after the newer
    When the trace-day count takes them
    Then both are counted, and the row keeps the newer one's time

  @unit @integration
  Scenario: Root spans of one project and day are written as one increment
    Given root spans of one project queued on one UTC day
    When the queue drains them as one batch
    Then the day's row gets one upsert adding their trace counts, and failed traces the same
    And two writers adding to one day at once lose no count

  @unit @integration
  Scenario: A trace stored twice counts once
    Given a trace's root span counted on its project's day
    When the trace is stored again in a second version, or its batch is redelivered or retried
    Then the trace counts once, in one batch or across batches or writers
    And its counted row is kept as long as its day row, 30 days

  @unit
  Scenario: An organization past its counting window writes no counts
    Given an organization created more than 21 days before a trace or failure, or never seen created
    When the trace or failure is counted
    Then no counted-trace row and no count is written for it
    And its organization's sync sends no trace trait

  @unit
  Scenario: The trace traits are removed once when an organization's window ends
    Given an organization whose trace counting window ended within the last sweep's span
    When the hourly sweep runs, on time or late
    Then its trace traits go once as null on the organization and on each member it is the latest of
    And no other trait is sent with them
    And its projects' trace days and counted traces are deleted
    And a refused call, a member's identify included, fails the sweep, so it is retried
    And the retried sweep sends the same nulls again

  @unit
  Scenario: A new project whose copy lands within the retry window is counted
    Given a trace of a new project whose placement nurturing has not copied yet
    When the trace is counted
    Then the batch fails after counting the rest, and the queue retries it
    And when the copy lands a retry later, about 30 seconds in, the trace counts once
    And a copy landing a second before the window ends is counted on the first attempt at or past it

  @unit
  Scenario: A project with no copy after the retries is dropped, and its later batches at once
    Given a project nurturing has no placement copy of
    When its trace batch is still uncopied on the first attempt at or past the retry window
    Then the batch is dropped without failing, and no count is written
    And a later batch of the project is dropped at once, with no retry and no failure
    And once the project's copy lands, its next trace counts

  @unit
  Scenario: A trace of an organization older than nurturing's creation copy is dropped
    Given a project nurturing placed in an organization it has no creation copy of
    When a trace of the project is counted, however young
    Then it is dropped without failing the batch, and no count is written

  @unit
  Scenario: Folds keyed across aggregates never re-fold from one aggregate's log
    Given a fold whose row sums many owner aggregates, a project
    When an event older than the row's newest arrives
    Then it is folded on as it comes, since a re-fold would rebuild the row from one aggregate

  @unit
  Scenario: Traces sync an organization at most once per 15 minutes
    Given traces arrive in two projects of one organization within 15 minutes
    Then they share one sync, one group call
    And a trace fact from before facts named their organization syncs on its project instead

  @unit
  Scenario: A project's first trace syncs its organization too
    Given trace records a project's first real trace as first_trace_recorded, not trace_received
    When nurturing takes it
    Then the organization syncs, throttled as a later trace's sync is
    And the trace is counted once, by its root span, since a sync only reads the counts

  @unit
  Scenario: A steady stream of a project's facts still syncs within a minute
    Given a project's owner facts arriving less than a minute apart without pause
    When its fold's subscriber takes them
    Then the organization syncs a minute after the first fact, not after the stream stops

  @unit
  Scenario: The organization's traits sum its projects' trace days
    Given trace days of an organization's projects, some older than the 30-day window
    When the organization syncs
    Then trace_count, error_count, last_trace_date and last_failed_trace_at come from the days in the window

  @unit @integration
  Scenario: Trace days older than the window are deleted
    Given a project's trace day and counted traces older than the 30-day window, of an organization past its counting window
    When its organization syncs
    Then that day's row and the project's counted traces that old are deleted

  @unit
  Scenario: A sync past the counting window deletes old trace days, even without an admin
    Given an organization past its counting window, without an admin, whose project kept a trace day older than the 30-day window
    When the project's usage changes
    Then that day's row is deleted
    And nothing is sent
    And a sync inside the counting window deletes nothing, since no day there is older than the window

  @unit
  Scenario: A trace past the organization's counting window syncs nothing
    Given a project whose organization is past its counting window, or that nurturing never saw created or placed
    When the project traces
    Then nothing is read of its sums and nothing is sent
    And inside the window the trace syncs the organization as a usage change does

  @unit
  Scenario: The organization's traits sum its projects
    Given an organization with two projects with usage and its trace counts
    When the traits are built
    Then prompt, evaluator, scenario, simulation set, trace and error counts are summed
    And last_trace_date and last_failed_trace_at are the newest trace and failed trace in Unix seconds
    And active_last_7_days, back_since_day_0, has_scenario_run and window_end_date are set

  @unit
  Scenario: The organization's activity on signup days 0, 1, 12 and 13 is a trait each
    Given an organization that signed up 13 days ago, with traces on days 0, 12 and 13
    When the traits are built
    Then active_day_0, active_day_12 and active_day_13 are true and active_day_1 is false

  @unit
  Scenario: A signup day that left the window is not sent
    Given an organization that signed up 40 days ago
    When the traits are built
    Then active_day_0 and active_day_1 are left out, so Customer.io keeps their last values
    And active_day_12 and active_day_13 are sent

  @unit
  Scenario: A habit is activity on 3 or more days at least 7 days apart, or in 3 ISO weeks
    Given an organization's active days within the window
    When the traits are built
    Then has_habit is true for 3 or more distinct UTC days whose first and last are 7 or more days apart
    And has_habit is true for activity in 3 or more distinct ISO weeks
    And has_habit is false otherwise

  @unit
  Scenario: Prompt versions, scenario runs and evaluations count toward the habit
    Given an organization with traces on one day
    And prompt-version, scenario-run or evaluation days on others within the window
    When the traits are built
    Then has_habit counts every kind's days together, each day once

  @unit
  Scenario: A changed project sends its organization's traits as one group call on the admin
    Given a project placed in an organization with an admin
    When the project's usage changes
    Then Customer.io receives one group call on the admin with the organization's traits

  @unit
  Scenario: Nurturing keeps its own copy of an organization's members
    Given the owners' facts of a person joining by signup, invite, single sign-on or founding an organization, leaving by removal or disabling, and returning by enabling
    When nurturing takes them, in any order and any number of times
    Then the person is a current member when their latest join or return is after their latest leave
    And their latest organization is their current membership with the latest join

  @unit
  Scenario: An erased account leaves nurturing's member copy
    Given nurturing's member copy holds user-1 in two organizations and user-2 in one
    When user records user-1 erased, delivered twice
    Then no membership names user-1, and user-2's stays
    And neither Customer.io nor PostHog receives a request

  @unit
  Scenario: Each member of the organization gets its traits as person attributes
    Given an organization with two members in nurturing's copy, each of whom joined it last
    When a project of the organization changes its usage
    Then after the group call, each member is identified with the organization's traits

  @unit
  Scenario: A member who joined another organization since does not get this one's traits
    Given a member of the organization who joined a different organization after it
    When a project of the organization changes its usage
    Then that member is not identified with this organization's traits
    And the other members still are

  @unit
  Scenario: A failed identify is reported and swallowed
    Given Customer.io refuses the members' identify, or nurturing's member copy cannot be read
    When a project of the organization changes its usage, not at a window's end
    Then the failure is reported as a warning and the sync does not fail
    And the group call has already been sent

  @unit
  Scenario: A project nurturing never saw created sends nothing
    Given a project created before nurturing kept its copy of placements
    When the project's usage changes or it traces
    Then Customer.io receives nothing

  @unit
  Scenario: An organization nurturing never saw created gets no group call and no member identify
    Given a project nurturing placed in an organization with an admin and members in nurturing's copy
    And the organization was created before nurturing kept its copy of organization creation
    When the project's usage changes or it traces
    Then Customer.io receives no group call and no member identify, so no partial sum is sent

  @unit @integration
  Scenario: A created project is placed in its organization from the creation fact
    Given project records lw.project.created for a project of an organization
    When nurturing's placement subscriber takes it, once or redelivered
    Then nurturing's own copy places the project in that organization
    And the organization's projects list it

  @unit
  Scenario: A moved or archived project keeps its placement
    Given a placed project
    When project records lw.project.moved or lw.project.archived for it
    Then its placement is unchanged, since a move stays within the organization

  @unit @integration
  Scenario: The signup day comes from the organization's creation fact
    Given organization records lw.organization.created
    When nurturing's subscriber takes it, once or redelivered with a later time
    Then nurturing keeps the earliest creation time as the organization's signup day
    And an organization created before nurturing kept the copy has no signup day

  @unit
  Scenario: Without a Customer.io channel nothing is counted, but the copies are kept
    Given nurturing runs without a Customer.io channel
    When its usage pipeline is built
    Then it registers no fold, no trace count and no sync, so a root span writes no trace day
    And it registers the placement, organization-creation and six member copies

  @integration
  Scenario: Each owner's fold keeps its own row per project
    Given the prompt fold and the scenario fold each store a row for the same project
    Then each owner's row is read back apart, with the event ids of its last delivery

  @integration
  Scenario: A row of another projection version is never counted, nor folded over
    Given a stored row of an older projection version
    Then the fold store reads it as undecodable, which the executor refuses to fold over
    And the organization's read leaves it out

  @integration
  Scenario: The organization's rows are read for its projects only
    Given rows for a project of the organization and for another project
    When the organization's rows are read for its projects
    Then every owner's row of its projects is returned and no other
