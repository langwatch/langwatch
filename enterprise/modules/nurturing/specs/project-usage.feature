Feature: Per-email usage reaches Customer.io from nurturing's own project rows

  Nurturing folds the owners' prompt, evaluator, scenario and simulation-run events into its own
  table (peer folds, ARCHITECTURE §9). A peer fold re-folds from one owner's event log, so there
  are four folds, one per owner pipeline, each keeping its own row per project. Evaluation's
  settled facts add their project's UTC day to nurturing's evaluation-day copy, a peer map written
  insert-ignore and filled at deploy from evaluation's log; the evaluation rows a retired
  subscriber kept in the usage table stay there, unread. Traces are counted by two peer folds, one
  per owner pipeline, since a peer fold re-folds from one owner's log: one over trace's
  span_received, whose enqueue filter stages root spans only (a root span is one trace), and one
  over trace's own lw.trace.trace_failed fact, recorded once per trace by trace's rule (any span's
  error), so nurturing keeps no copy of that rule. Sample and Langy traces are left out, as trace
  leaves them out of a project's first trace. Each fold keeps its own row per project and UTC day
  of append (NurturingProjectTraceDayCount, keyed by project, day and source), with the event ids
  of its last delivery, so a redelivered batch folds once; a root span stored again under a new
  event id (a re-emitted span_received) still counts again, accepted (owner decision, issue 9378).
  The read sums a day's two rows. The folds count every project's traces, placed or not and
  whatever its organization's age, so a new project's first traces count before its placement
  copy lands; the counting window (its organization's creation plus the 14-day free window and a
  week) gates the read, so an organization past it gets no trace trait. An hourly sweep (a
  scheduled process, since an organization that stopped tracing syncs no more) sends each
  organization's trace traits once as null when its window ends, so Customer.io removes them and a
  rolling trait never says "active" for ever; later syncs leave them out, and its trace rows are
  dropped. The same sweep drops every trace day older than the 30-day usage window, those of
  projects that never synced included. A deploy replay rebuilds the trace days from trace's log,
  one counting window back, as live delivery wrote them; the retired NurturingProjectTraceDay
  table stays, unread. No span body reaches nurturing.
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
  lw.organization.member_removed or member_disabled, a return by member_enabled, and a membership
  from before organization recorded member facts by its lw.organization.member_listed, joined when
  its row was created. Each keeps its latest time, so a redelivery, a late fact or a replay changes
  nothing; "joined last" is the latest join time in the copy. Two peer maps write it, one per owner
  pipeline (organization's and auth's), filled at deploy by their replay steps. User's
  lw.user.erased marks the account erased (NurturingErasedUser, a hash of its id), then deletes
  every membership of it (with the other rows naming it, project-facts-copies.feature); a member
  fact delivered after the erasure, or while it commits, leaves no row for it, unless its worker
  stops between the write and its re-check, which leaves the row until the fact is redelivered.
  The usage mirror reads the marks too, so such a row, or one from before the marks, gets no
  identify.
  On a usage sync a failed identify is reported and swallowed, as the
  other sinks' failures are; the group call stands. A failed read of the members fails the sync, which retries. At a window's end it fails the sweep, which retries. A project's first trace syncs as later ones do. The
  signup day comes from its own copy of
  lw.organization.created. It reads no other module's table and calls no other module's API for
  a usage fact. Its placement, organization-creation and admin copies are peer maps over project's
  and organization's facts, filled at deploy by replaying those logs, so a project or organization
  whose creation the owner's log holds is copied however old; one it does not hold sends nothing. It never pulls owner state on a
  schedule, and sends counts and times only, never content. flagged_count waits on its
  definition. Without a Customer.io channel no usage fold or sync is registered, and the
  evaluation-day and trace-day lanes register for their replay steps but keep no row: nothing is
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
  Scenario: Evaluations mark a project's day once
    Given several evaluations of a project complete on the same UTC day, one of them delivered twice
    Then nurturing's evaluation-day copy holds that day once for the project
    And a burst of one project's evaluations on one day is written as one batch

  @unit
  Scenario: The deploy replay fills the evaluation days as live delivery would
    Given evaluation's log holds settled evaluations from before the evaluation-day map existed
    When the nurturing:replay-evaluation-days step runs, and runs again
    Then nurturing's evaluation-day copy holds the days per-fact live delivery of the same facts holds
    And the second run changes no row

  @unit
  Scenario: The deploy replay re-derives every day the migration copied
    Given the replay step starts 31 days before the earliest release date, a fixed instant
    When it runs
    Then it fills every day the usage read reaches at release, the days the migration copied included
    And a fact older than its instant is not replayed

  @unit
  Scenario: A deploy replay sends nothing to Customer.io or PostHog
    Given evaluation's log holds settled evaluations
    When the evaluation-day replay step runs
    Then no usage sync, trace count or organization-creation send runs

  @unit
  Scenario: Evaluation days are dropped once their organization's window has passed
    Given an organization past its counting window, whose projects hold evaluation days
    When its usage syncs, or the hourly sweep ends its window
    Then every evaluation day of its projects is deleted, as nothing reads them past the window

  @integration
  Scenario: The usage read leaves out the evaluation rows the retired subscriber wrote
    Given a project's evaluation row in the usage table, as the previous release wrote it
    When the organization's usage rows are read
    Then the evaluation row is not among them, and it is left unchanged

  @unit
  Scenario: A subscription_changed job the previous release queued still sends its plan
    Given the previous release queued a job under the retired subscriptionChanged lane
    When a worker of this release takes it
    Then the plan fold folds it and its send tells Customer.io the plan once
    And the former lane is routed to the plan fold, never tombstoned

  @unit
  Scenario: A job queued under a retired copy lane reaches its successor
    Given the previous release queued a job under the evaluation-day subscriber's lane
    When a worker of this release takes it
    Then the evaluation-day map writes its day, and the job is neither dead-lettered nor dropped

  @integration
  Scenario: A project's evaluation days are kept once each, whatever order and however often they land
    Given evaluations of a project completed on three UTC days
    When their days are written one at a time, in one order or its reverse, then again in one batch with repeats
    Then nurturing's evaluation-day copy holds each of the three days once for the project

  @integration
  Scenario: The migration copies each evaluation usage row's days and deletes nothing
    Given evaluation usage rows whose active days are two, three and none, and a row of another owner
    When the migration's copy runs
    Then nurturing's evaluation-day copy holds one row per active day of each evaluation row
    And every old usage row is exactly as it was

  @integration
  Scenario: The copy can run again without adding or changing a row
    Given the migration's copy has already run
    When the copy runs again
    Then no evaluation-day row is added or changed
    And no old usage row is changed

  @integration
  Scenario: The copy skips an evaluation row whose active days are not a list
    Given an evaluation usage row with a list of active days
    And evaluation usage rows whose active days are an object and a string
    When the migration's copy runs
    Then it succeeds
    And nurturing's evaluation-day copy holds only the listed row's days

  @unit @integration
  Scenario: A trace is its root span, counted on its project's day
    Given root spans of a project's traces appended on one UTC day
    When the trace-day spans fold takes them
    Then each adds one trace to the project's row for that day
    And a root span appended on the next UTC day counts on the next day's row

  @unit
  Scenario: Only a root span mints a trace-day fold job
    Given a trace's root span and its child spans
    When trace appends them
    Then only the root span is staged on the trace-day spans fold, so a child span costs no job
    And a child span a replay hands the fold counts nothing

  @unit
  Scenario: Sample and Langy traces are not counted
    Given root spans whose langwatch.origin, on the span or else its resource, is sample or langy
    When trace appends them
    Then none is staged on the trace-day spans fold, as trace keeps them out of a project's first trace
    And one a replay hands the fold is not counted
    And a root span of any other origin, or none, is staged
    And a trace_failed of a sample or Langy trace mints no failures fold job and counts no failed trace

  @unit
  Scenario: Governance-ingested traces are not counted
    Given root spans stamped langwatch.origin.kind "ingestion_source" by governance ingestion
    When trace appends them
    Then none is staged on the trace-day spans fold, as trace keeps them out of a project's first trace
    And one a replay hands the fold is not counted
    And a root span of any other origin kind is staged

  @unit
  Scenario: A failed trace is counted from trace's trace_failed fact
    Given trace records trace_failed for a project's trace, by its own rule
    When the trace-day failures fold takes it
    Then the project's failures row of the fact's day counts 1 failed trace, and its time
    And a root span's error status alone counts no failed trace

  @unit
  Scenario: A failure on the day after its trace's root span still counts
    Given a project's trace counted on one UTC day and its trace_failed appended on the next
    When the organization's traits are built
    Then error_count counts the failure, and its day is an active day

  @unit
  Scenario: Traces arriving out of order count the same
    Given two traces' root spans of one project and day, the older arriving after the newer
    When the trace-day spans fold takes them
    Then both are counted, and the row keeps the newer one's time

  @unit @integration
  Scenario: The spans and failures folds keep their own rows of a day, which the read sums
    Given a project's root spans and trace_failed facts on one UTC day
    When both trace-day folds store their rows
    Then the day holds one spans row and one failures row, each with its own applied event ids
    And neither fold's write changes the other's row
    And the organization's read sums both rows into one day

  @unit
  Scenario: A redelivered span_received folds once
    Given a trace's root span counted on its project's day
    When the same span_received is delivered again, with the same event id
    Then the day's trace count is unchanged
    And a root span stored again under a new event id counts again; accepted (issue 9378)

  @unit @integration
  Scenario: A trace of a project with no placement copy yet is counted, and syncs once the copy lands
    Given a project whose placement nurturing has not copied yet
    When its trace is folded
    Then it is counted, with no retry and no failure
    And once the placement and organization copies land, the organization's sync sends the count

  @unit
  Scenario: An organization past its counting window gets no trace trait
    Given an organization created more than 21 days ago, or never seen created, whose project traced
    When the trace is folded
    Then it is counted on the project's day
    And its organization's sync sends no trace trait

  @unit
  Scenario: The trace traits are removed once when an organization's window ends
    Given an organization whose trace counting window ended within the last sweep's span
    When the hourly sweep runs, on time or late
    Then its trace traits go once as null on the organization and on each member it is the latest of
    And no other trait is sent with them
    And its projects' trace days are deleted
    And a refused call, a member's identify included, fails the sweep, so it is retried
    And the retried sweep sends the same nulls again

  @unit @integration
  Scenario: The hourly sweep drops every trace day older than the usage window
    Given trace days older than the 30-day usage window, of a project that never synced and of one that did
    When the hourly sweep runs
    Then every such day is deleted, and the days inside the window are kept
    And a failed prune is logged and left to the next sweep, without failing the sweep

  @unit
  Scenario: The deploy replay rebuilds the trace days as live delivery wrote them
    Given trace's log holds root spans, child, sample and Langy spans and trace_failed facts
    When the trace-day replay steps run over an empty table
    Then each project's day rows equal the rows live delivery of the same facts wrote
    And running the steps again leaves every row as it was
    And no sync, count or creation hook is called, so nothing is sent

  @unit
  Scenario: Folds keyed across aggregates never re-fold from one aggregate's log
    Given a fold whose row sums many owner aggregates, a project
    When an event older than the row's newest arrives
    Then it is folded on as it comes, since a re-fold would rebuild the row from one aggregate

  @unit
  Scenario: Traces sync an organization at most once per 15 minutes
    Given traces arrive in two projects of one organization within 15 minutes
    Then they share one sync, one group call
    And three projects' first traces in one organization share one sync, one group call and its member identifies
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
    Given a project's trace day older than the 30-day window, of an organization past its counting window
    When its organization syncs
    Then that day's row is deleted

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
  Scenario: Each usage sync run is logged with counts, never ids
    Given the nurturing app is built with or without a Customer.io API key
    Then startup logs whether the usage sync is enabled and whether the key is present, never the key
    When an organization's usage syncs
    Then one debug line logs its project, group call, identify call and member counts, and whether mirroring failed
    And a sync skipped for want of an admin, a placement or a counting window logs its reason at debug
    And a counter records each sync attempt's outcome, never an id
    And a refused group call counts as send_failed and the sync still rejects, so the job retries
    And a failed trace_active_day claim or batch counts as events_failed and the sync still rejects
    And any other failure of a sync counts once as error and the sync still rejects
    And the hourly trace-window sweep logs one info line with how many ended, synced and had no admin
    And the run lines and the counter carry no organization, user or project id
    And a failure warning keeps the organization id, as the one line needed to debug it

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
  Scenario: Each member gets trace_active_day once per UTC day their organization traced
    Given an organization inside its counting window that traced today and yesterday
    When its usage syncs
    Then each member the traits are mirrored onto is tracked trace_active_day once for each of those days, after the identifies
    And each event carries the day as date and its days_since_signup, the n of the active_day_<n> trait the same day sets
    And the four active_day traits are still sent, as live campaigns branch on them

  @unit
  Scenario: A sync sends trace_active_day for today and yesterday only
    Given an organization's traced days within the window
    When its usage syncs
    Then trace_active_day goes for today's and yesterday's traced days only, so a sync just past midnight still sends the day before
    And no older day is sent again once its claim has lapsed
    And a traced day before the signup day is not sent

  @unit
  Scenario: trace_active_day is never sent twice for a member and day
    Given a member already tracked trace_active_day for a day
    When the organization syncs again, its sync job is redelivered or retried
    Then no second trace_active_day goes for that member and day: each is claimed per member and day for 7 days
    And its message id is stable per member and day, so Customer.io drops a repeat too

  @unit
  Scenario: A failed trace_active_day send fails the sync, and its retry sends the events once
    Given Customer.io refuses a batch of trace_active_day events, or a claim fails midway
    When the sync runs
    Then the batch's claims are given back, the sync counts as events_failed and rejects, so the job retries
    And the retried job sends each event once

  @unit
  Scenario: A refused identify does not hold back trace_active_day
    Given Customer.io refuses the members' identify
    When an organization that traced today syncs
    Then the identify failure is reported and swallowed
    And each member the traits are mirrored onto is still tracked trace_active_day, in its own step after the mirror

  @unit
  Scenario: An organization past its counting window gets no trace_active_day
    Given an organization created more than 21 days ago whose project traced today
    When its usage syncs
    Then no member is sent trace_active_day

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
    Given the owners' facts of a person joining by signup, invite, single sign-on, founding an organization or being listed by organization, leaving by removal or disabling, and returning by enabling
    When nurturing takes them, in any order and any number of times
    Then the person is a current member when their latest join or return is after their latest leave
    And their latest organization is their current membership with the latest join

  @unit
  Scenario: An erased account leaves nurturing's member copy
    Given nurturing's member copy holds user-1 in two organizations and user-2 in one
    When user records user-1 erased, delivered twice
    Then no membership names user-1, and user-2's stays
    And neither Customer.io nor PostHog receives a request

  @integration
  Scenario: A member fact landing after an erasure writes no member row in Postgres
    Given nurturing's member copy in Postgres holds user-1, who is then erased
    When a member fact joining user-1 to the organization lands
    Then no membership names user-1

  @integration
  Scenario: A member fact landing while an erasure commits leaves no member row in Postgres
    Given nurturing's member copy in Postgres holds user-1
    And user-1's erasure mark has committed but its deletion of their memberships has not run
    When a member fact joining user-1 to the organization lands
    Then no membership names user-1

  @integration
  Scenario: A member fact for a marked account writes no row even if its re-check never runs
    Given user-1's erasure mark is in Postgres
    When a member fact joining user-1 is written and its worker stops before the re-check
    Then the write fails, and no membership names user-1

  @integration
  Scenario: A member row left naming an erased person gets no usage identify
    Given nurturing's member copy in Postgres holds user-1 and user-2, both of whom joined it last
    And user-2's erasure mark is in Postgres while their member row still stands
    When a project of the organization changes its usage
    Then user-1 is identified with the organization's traits, and user-2 is not

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
    Given Customer.io refuses the members' identify
    When a project of the organization changes its usage, not at a window's end
    Then the failure is reported as a warning and the sync does not fail
    And the group call has already been sent

  @unit
  Scenario: A failed member read fails the sync
    Given nurturing's member copy cannot be read
    When a project of the organization changes its usage, not at a window's end
    Then the sync rejects, so the job retries and no trace_active_day event is lost

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
    When nurturing's placement map takes it, once or redelivered
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
    When nurturing's creation map takes it, once or redelivered with a later time
    Then nurturing keeps the earliest creation time as the organization's signup day
    And an organization created before nurturing kept the copy has no signup day

  @unit
  Scenario: Without a Customer.io channel nothing is counted, but the copies are kept
    Given nurturing runs without a Customer.io channel
    When its usage pipeline is built
    Then it registers no usage fold and no sync
    And it registers the placement, organization-creation, admin and member copies
    And its evaluation-day lane registers, so its replay step runs, but keeps no day
    And its trace-day lanes register, so their replay steps run, but a root span writes no trace day

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

  # Projections build plan rows 1, 3 and 5a: the placement, organization-creation and admin copies
  # are peer maps whose writes are order-free and idempotent, filled at deploy by their replay steps.
  @unit
  Scenario: Projects and organizations created before the copies existed are copied at deploy
    Given project's and organization's logs hold creations from before nurturing kept the copies
    When the deploy runs nurturing's placement, organization-creation and admin replay steps
    Then each copy holds what live delivery of the same facts would have written

  @unit
  Scenario: Replaying the organization copies twice leaves every row as it was
    Given the placement, organization-creation and admin steps ran
    When each runs again
    Then every row is byte-identical

  @unit
  Scenario: Each organization copy ends the same whatever order its facts land in, however often
    Given project's and organization's creation facts
    When they are delivered live in reverse order, or each twice
    Then the placement, organization-creation and admin rows are those of one delivery in order

  @unit
  Scenario: The deploy replay names no admin erased before the copy existed
    Given project's log names an admin that user's log records erased
    When the deploy runs the marks steps and then the admin step, or the admin is erased while it runs
    Then no organization names that person as admin

  @unit
  Scenario: A late project-created fact naming an erased admin names no one
    Given an organization's admin copy and a person user's log records erased
    When a project-created fact naming that person at a later stamp is delivered live
    Then the organization names no admin

  @unit
  Scenario: Replaying the organization copies sends nothing
    Given a deployment with a Customer.io channel and logs holding organization and project creations
    When the deploy runs nurturing's replay steps
    Then no organization-created, usage or trace sync runs

  @unit
  Scenario: Copy jobs the previous release queued reach the peer map that replaced their lane
    Given the previous release queued jobs under the placement, organization-created, project-created and seven member subscriber keys
    When a worker of the new release dequeues them
    Then the placement, organization-creation, admin and member maps each write their copy

  # Projections build plan row 4: the member copy is two peer maps, organization's member facts
  # (member_listed included) and auth's single sign-on joins, filled at deploy after the marks.
  @unit
  Scenario: Members from before the copy existed are copied at deploy from organization's and auth's logs
    Given organization's log holds member facts and member_listed facts, and auth's holds single sign-on joins
    When the deploy runs nurturing's organization and auth member replay steps
    Then the member copy holds what live delivery of the same facts would have written

  @unit
  Scenario: Replaying the member copy twice leaves every row as it was
    Given both member steps ran
    When each runs again
    Then every member row is byte-identical

  @unit
  Scenario: Every active member organization lists gets a member row, once
    Given organization's listing step recorded a member_listed fact for each active membership
    When the deploy runs the organization member step, and runs it again
    Then each listed member is a current member of their organization, and the second run adds no row

  @unit
  Scenario: The deploy replay copies no member erased before the copy existed
    Given organization's and auth's logs name a member that user's log records erased
    When the deploy runs the marks steps and then the member steps, or the member is erased while they run, or a fact naming them lands live afterwards
    Then no membership names that person

  @unit
  Scenario: Replaying the member copy sends nothing
    Given a deployment with a Customer.io channel and logs holding member facts
    When the deploy runs nurturing's replay steps
    Then no usage, trace or organization-created sync runs
