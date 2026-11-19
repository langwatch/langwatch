Feature: Nurturing keeps its own copy of personal owners and traced projects, from owners' facts

  Nurturing answers "who owns this personal project" and "has this organization ever traced"
  from rows it owns, written by its peer maps from the owners' facts: organization's
  personal-workspace facts and project's listed owners name an owner; trace's traced fact and
  project's listed first messages name a traced project. These copies change no read yet: the
  traits a person is sent are still read where they were. Writing a copy calls no sink, so no
  Customer.io or PostHog request comes from these facts.

  Each copy is a peer map on nurturing's usage host, so a deploy step replays it from its owner's
  log, after the erasure-mark steps for the owners and after project's listing step for the lanes
  that read project's listed facts. A replay writes the store alone and runs no subscriber: it sends
  nothing. Every write is order-free (the first owner stays, a traced row is insert-ignore, a trace
  time only moves forward), so a redelivered, late or replayed fact leaves a row as live delivery
  would. An organization's last trace time is a third map on trace's first and later trace facts: a
  fact naming no organization writes nothing, and a burst is written as one organization's latest
  time. The five subscriber lanes the maps replace are aliased to them for one release.

  When user records an account erased, nurturing marks it erased (NurturingErasedUser, a hash of
  its id), deletes every owner row naming it, in every organization, and clears it wherever its
  own organization rows name it admin. It reads no other module's table and calls no sink. No
  signal delivered after the mark reaches the account, and no read names it admin again: a late
  project-created fact naming it admin stores it, but the mark reads it as no admin. The mark
  is written when nurturing handles lw.user.erased, after user has committed the erasure: a
  signal about the account delivered in between, however long that handling lags or retries,
  still sends, and an identify then can recreate its Customer.io person, which nurturing never
  deletes. A personal-owner fact delivered after the mark (a delayed listing, a redelivered
  workspace fact or a replay) writes no owner row for the account: the owner write reads the
  marks, and reads them again after the write, so a fact racing the erasure leaves no owner row
  either.

  @unit @integration
  Scenario: A new personal workspace leaves one owner row naming its member
    When organization records a personal team for member user-1, delivered twice
    Then nurturing holds one owner row for its project naming user-1
    And neither Customer.io nor PostHog receives a request

  @unit
  Scenario: A second personal team fact leaves the first owner row unchanged
    Given nurturing holds an owner row for a personal project
    When organization records the same team again with a new project id
    Then the first row is unchanged
    And the new id gets a row of its own, which no project uses

  @unit
  Scenario: Project's listed owners fill the owner rows, and a live row stays as it was
    Given nurturing holds an owner row from a live personal workspace fact
    When project lists that project and another personal project with their owners
    Then the live row keeps its owner
    And the other project gets a row naming its listed owner
    And neither Customer.io nor PostHog receives a request

  @unit @integration
  Scenario: Trace's traced fact leaves one traced row for its organization
    When trace records a project of an organization with no admin as traced, delivered twice
    Then nurturing holds one traced row for that project and answers its organization traced
    And neither Customer.io nor PostHog receives a request

  @unit
  Scenario: A traced fact with no organization writes no row
    When trace records a project whose team is gone as traced
    Then nurturing writes no traced row
    And one line naming the project is logged

  @unit
  Scenario: Project's listed first messages fill the traced rows, and a live row stays as it was
    Given nurturing holds a traced row from trace's live fact
    When project lists that project and another one as having received their first message
    Then each project has exactly one traced row
    And neither Customer.io nor PostHog receives a request

  @unit @integration
  Scenario: An erased account's owner and admin rows are cleared, and nothing is sent
    Given nurturing holds owner rows for user-1 in two organizations and one for user-2
    And nurturing's organization rows name user-1 admin of one organization and user-2 of another
    When user records user-1 erased, delivered twice
    Then no owner row names user-1, and user-2's row stays
    And no organization row names user-1 admin, and user-2 stays admin of its organization
    And neither Customer.io nor PostHog receives a request

  @unit @integration
  Scenario: An erased admin a late fact names again reads as no admin
    Given user-1, admin of an organization, was erased
    When a late project-created fact names user-1 admin of it again
    Then nurturing reads the organization as having no admin
    And so no plan, usage or gateway key send names user-1 its admin

  @unit @integration
  Scenario: A personal-owner fact landing after the owner's erasure writes no owner row
    Given user-1 owned a personal project and was erased
    When a personal-owner fact naming user-1 lands late, for that project or another
    Then nurturing holds no owner row naming user-1, and user-2's owner row is written as before

  @integration
  Scenario: A personal-owner fact landing while its owner's erasure commits leaves no owner row
    Given nurturing wrote an owner row naming user-1
    And user-1's erasure mark has committed but its delete has not run
    When the owner fact is delivered again
    Then nurturing holds no owner row naming user-1

  @integration
  Scenario: A personal-owner fact for a marked owner writes no row even if its re-check never runs
    Given user-1 is marked erased
    When an owner fact naming user-1 is written and the worker stops before its re-check
    Then the write fails, so the fact is retried
    And nurturing holds no owner row naming user-1

  @unit @integration
  Scenario: A late project-created fact naming an erased admin writes no admin
    Given an organization's row names user-2 admin, from a fact stamped T1
    And user-1 was erased
    When a project-created fact stamped T2, after T1, names user-1 admin
    Then the organization's row names no admin, stamped T2
    And a fact stamped before T2 naming another admin does not fill it

  @integration
  Scenario: A project-created fact landing while its admin's erasure commits leaves no admin
    Given nurturing named user-1 admin of an organization
    And user-1's erasure mark has committed but its clearing has not run
    When the project-created fact is delivered again
    Then the organization's row names no admin

  @integration
  Scenario: A project-created fact for a marked admin writes no admin even if its re-check never runs
    Given user-1 is marked erased
    When a project-created fact naming user-1 admin is written and the worker stops before its re-check
    Then the write fails, so the fact is retried
    And the organization's row names no admin

  @unit
  Scenario: A signal about an erased account, delivered late, sends them nothing
    Given user-1 was erased
    When a signal about user-1, such as a scenario they created, is delivered afterwards
    Then neither Customer.io nor PostHog receives a request

  @unit
  Scenario: A signal whose erasure marks cannot be read fails before any claim or send
    Given nurturing cannot read its erasure marks
    When a signal is delivered
    Then the delivery fails, so the fact is retried
    And no delivery claim is taken, and neither Customer.io nor PostHog receives a request

  @unit @integration
  Scenario: An erasure of an account nurturing holds no row for changes nothing
    Given nurturing holds owner and admin rows for user-1 and user-2
    When user records erased an account no nurturing row names
    Then every owner and organization row is as it was
    And neither Customer.io nor PostHog receives a request

  @unit
  Scenario: Replaying the personal-owner lanes fills each owner row as live delivery would
    Given organization's log holds personal team and workspace facts, and project's lists owners
    When the personal-owner replay steps run after the erasure marks
    Then each personal project has the owner live delivery of the same facts would have left
    And neither Customer.io nor PostHog receives a request

  @unit
  Scenario: Replaying a copy twice leaves every row as it was
    Given a copy's replay step has run, its trailing pass included
    When the step runs again
    Then every row of the copy is as it was

  @unit
  Scenario: A personal owner's facts delivered again or in reverse order leave the same row
    Given two owner facts name the same personal project and owner
    When they are delivered twice, or in reverse order
    Then nurturing holds one owner row for the project, the same each time

  @unit
  Scenario: A personal owner erased before the replay is on no owner row after it
    Given user-1 was erased and owned personal projects in organization's and project's logs
    When the personal-owner steps run after the marks steps
    Then no owner row names user-1, and another owner's row is written
    And the owner step run before the marks would have stored user-1, which the declared order prevents

  @unit
  Scenario: A personal owner erased during the replay is on no owner row after it
    Given user-1's erasure lands between two replayed owner facts
    When the replay ends
    Then no owner row names user-1

  @unit
  Scenario: Replaying the traced-project lanes fills each traced row as live delivery would
    Given trace's log holds traced facts, one naming no organization, and project lists first messages
    When the traced-project replay steps run
    Then each project with an organization has one traced row, as live delivery would leave it
    And the project with no organization is logged and has no row
    And neither Customer.io nor PostHog receives a request

  @unit
  Scenario: A traced fact delivered again or in reverse order leaves the same rows
    Given trace's and project's logs name the same projects
    When the facts are delivered twice, or in reverse order
    Then the traced rows are the same each time

  @unit
  Scenario: Jobs the previous release queued under a retired copy lane reach its successor map
    Given the previous release queued jobs under its personalTeamCreated, personalWorkspaceProvisioned, personalOwnerListed, projectTraced and firstMessageListed lanes
    When a worker of this release dequeues them
    Then each reaches the map that records the same fact, and none is dead-lettered
    And nurturing's own pipeline registers none of the five lanes

  @unit
  Scenario: A copy lane is registered whether or not a channel syncs
    When nurturing's usage pipeline is built with or without a Customer.io channel
    Then the personal-owner, traced-project and last-trace maps are registered either way

  @unit
  Scenario: The copy steps run after the erasure marks and project's listing step
    Given nurturing's replay steps are declared
    Then the owner steps run after both erasure-marks steps, and the project lanes after project's listing step
    And the steps' ids are in the image's code steps

  @unit
  Scenario: The last-trace replay starts the day before the release
    Given the last-trace replay step is declared
    When it runs
    Then it replays from the day before the release, and the other copy steps from the start of the log

  @unit
  Scenario: Replaying the last-trace lane fills each organization's latest trace time
    Given trace's log holds trace facts of two organizations after the window opens, one before it, and one naming none
    When the last-trace replay step runs
    Then each organization has its latest trace time, the older one has none, and nothing is sent

  @unit
  Scenario: Replaying the last-trace lane twice, or in reverse order, leaves each time as it was
    Given the last-trace replay has run
    When it runs again, or runs over the same log in reverse order
    Then each organization's time is the same

  @unit
  Scenario: Five hundred trace facts of one organization are one write of the latest time
    Given 500 trace_received facts of one organization in one coalesced batch
    When the map's store writes the batch
    Then the store is written once, with the batch's latest time
    And a burst of the organization's facts is grouped together, in batches of 500

  @unit
  Scenario: A trace fact naming no organization writes nothing
    Given a trace fact that names no organization
    Then it maps to no record, mints no job and writes no row

  @integration
  Scenario: A trace time creates the organization's row, and only moves forward
    Given nurturing holds no row for an organization
    When a trace time is recorded, then an older one
    Then the organization's row holds the later time
