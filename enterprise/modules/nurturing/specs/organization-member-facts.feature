Feature: An organization's session facts reach every active member in Customer.io

  Campaigns read the person's own profile. A trace or a coding session is a fact
  about the organization, so every active member's profile carries it, not only
  the admin's. The milestones and their tracked events stay the admin's: this adds
  data only, and no member enters a campaign through a new event.

  Background:
    Given organization org-1 holds project-1 and project-2
    And its active members are admin-1 and member-2

  @unit
  Scenario: A later trace tells every active member last_trace_at and has_traces
    When a trace_received signal of project-1 is delivered
    Then Customer.io identifies admin-1 and member-2 with has_traces true and last_trace_at in Unix seconds

  @unit
  Scenario: A first trace tells every active member and stays the admin's milestone
    When a first_trace_integrated signal of project-1 is delivered
    Then Customer.io identifies admin-1 and member-2 with has_traces true and last_trace_at
    And only admin-1 is told the SDK and the first trace's time
    And only admin-1 is tracked first_trace_integrated

  @unit
  Scenario: A stored coding session tells every active member coding_last_session_at
    When a coding_session_stored signal of project-1 is delivered
    Then Customer.io identifies admin-1 and member-2 with coding_last_session_at in Unix seconds

  @unit
  Scenario: A new agent type tells every active member coding_agent_types
    When a coding_agent_types signal of project-1 is delivered
    Then Customer.io identifies admin-1 and member-2 with the full list

  @unit
  Scenario: The terminal types, repo count and first-three-days count tell every active member
    When each of those signals of project-1 is delivered
    Then Customer.io identifies admin-1 and member-2 with its value

  @unit
  Scenario: The active days stay the admin's
    When a coding_active_days signal of project-1 is delivered
    Then Customer.io identifies admin-1 only

  @unit
  Scenario: The first coding session tells every member coding_first_session_at once
    When the first-session signal carrying admin-1 and member-2 is delivered, then delivered again
    Then Customer.io identifies member-2 with coding_first_session_at and coding_agent_types once
    And only admin-1 is tracked coding_agent_first_session

  @unit
  Scenario: A member who joins by invite an organization with traces is told so
    Given org-1 already sent a trace
    When an invite_accepted signal for org-1 is delivered
    Then Customer.io identifies the person with has_traces true and the current last_trace_at

  @unit
  Scenario: A member who joins by SSO an organization with traces is not told false
    Given org-1 already sent a trace
    When an sso_auto_added signal for org-1 is delivered
    Then Customer.io identifies the person with has_traces true and the current last_trace_at
    And has_evaluations is still false

  # No backfill: an organization silent since this shipped has its traces on project's table,
  # and its time arrives with its next trace, which tells every member.
  @unit
  Scenario: A member who joins an organization whose traces predate the stored time gets has_traces alone
    Given a project of org-1 received its first message before nurturing stored a trace time
    When an sso_auto_added signal for org-1 is delivered
    Then Customer.io identifies the person with has_traces true and no last_trace_at

  @unit
  Scenario: An invite into an organization with no traces says nothing about traces
    When an invite_accepted signal for org-1 is delivered
    Then no has_traces trait is sent

  @unit
  Scenario: A person with no traces anywhere still starts at has_traces false
    When a signed_up or sso_auto_added signal is delivered for a person with no traces
    Then Customer.io identifies the person with has_traces false

  # Known limit: Customer.io has no conditional write, so a first trace landing between this read
  # and the send can still lose to the false. The next trace in the window after corrects it.
  @unit
  Scenario: Signing up never overwrites has_traces true with false
    Given the person already belongs to another organization that sent a trace
    When a signed_up signal for their new organization is delivered
    Then Customer.io identifies the person with has_traces true and that organization's last_trace_at

  @unit
  Scenario: A disabled membership still counts toward has_traces
    Given the person's only membership with traces was disabled
    When an sso_auto_added signal for a trace-free organization is delivered
    Then Customer.io identifies the person with has_traces true

  @unit
  Scenario: A busy organization sends one batch per debounce window
    When traces of project-1 and project-2 are delivered inside 300 seconds
    Then each member is identified once
    And after 301 seconds each member is identified again with the later time

  # Known limit: a trace the per-project window drops first is never recorded, so the stored time
  # can lag by up to that window.
  @unit
  Scenario: A trace the organization's window drops still moves the stored time
    Given a trace of project-1 was just told to the members
    When a later trace of project-2 is delivered inside 300 seconds
    Then a person joining now gets the later last_trace_at

  @unit
  Scenario Outline: A read that fails before the members are told loses nothing on the retry
    Given <read> fails once
    When a first_trace_integrated signal of project-1 is delivered
    Then the delivery fails and Customer.io is told nothing
    When the signal is delivered again
    Then Customer.io identifies admin-1 and member-2 with has_traces true and last_trace_at
    And only admin-1 is tracked first_trace_integrated, once

    Examples:
      | read            |
      | getPlacement    |
      | recordLastTrace |
      | getAllMembers   |

  @unit
  Scenario: A later trace whose member read fails gives back its windows
    Given getAllMembers fails once
    When a trace_received signal of project-1 is delivered, then delivered twice more
    Then the first delivery fails
    And each member is identified once

  @unit
  Scenario: A person signing up whose trace lookup fails still gets their profile
    Given the person's trace lookup fails
    When a signed_up signal is delivered
    Then Customer.io identifies the person with their email and no has_traces or last_trace_at
    And the person is tracked signed_up

  @unit
  Scenario: An invited person whose trace lookup fails still joins
    Given the person's trace lookup fails
    When an invite_accepted signal for org-1 is delivered
    Then no has_traces trait is sent
    And the person is tracked joined_via_invite and joined_organization

  @unit
  Scenario: An SSO person whose trace lookup fails still starts their milestones
    Given the person's trace lookup fails
    When an sso_auto_added signal for org-1 is delivered
    Then Customer.io identifies the person with has_evaluations false and no has_traces or last_trace_at
    And the person is tracked joined_via_sso and joined_organization

  @unit
  Scenario: A join event carries the seat the person joined with
    Given an invite_accepted or sso_auto_added signal for org-1 holding the role ADMIN, MEMBER, EXTERNAL or DEVELOPER
    When the signal is delivered
    Then the joined_via_invite, joined_via_sso and joined_organization events carry seat admin, member, lite_member or developer

  @unit
  Scenario: A join event with no known role carries no seat
    Given an invite_accepted or sso_auto_added signal for org-1 with no role, or one nurturing cannot name
    When the signal is delivered
    Then none of the join events carries a seat property

  @unit
  Scenario: A join is tracked as joined_organization beside its own event
    Given an invite_accepted or sso_auto_added signal for org-1 from after joined_organization shipped
    When the signal is delivered
    Then the person is tracked joined_organization with join_method invite or sso and message id joined_organization:<user>:<org>

  @unit
  Scenario: A redelivered or replayed join is tracked once
    Given the person's join of org-1 was delivered
    When the same signal is delivered again, even after the delivery window
    Then joined_organization is not tracked a second time

  @unit
  Scenario: An invite and an SSO add of the same person and organization are tracked once
    Given the person's invite_accepted signal for org-1 was delivered
    When their sso_auto_added signal for org-1 is delivered
    Then joined_organization is tracked once, and joined_via_sso is still tracked

  @unit
  Scenario: A person joining a second organization is tracked joined_organization again
    Given the person's join of org-1 was tracked joined_organization
    When their invite_accepted signal for org-2 is delivered
    Then joined_organization is tracked for org-2 as well

  @unit
  Scenario: A joined_organization that failed to send is tracked when the same join is replayed
    Given Customer.io answered the joined_organization track for the person and org-1 with an HTTP 500, or the request failed
    When the same invite_accepted signal is delivered again, and again after that
    Then joined_organization is tracked once and joined_via_invite is not tracked a second time

  @unit
  Scenario: A join from before joined_organization existed is not tracked as it
    Given an invite_accepted signal for org-1 that occurred before 2026-11-06
    When the signal is delivered
    Then joined_via_invite is tracked and joined_organization is not
    And no joined_organization slot is taken, so nothing is held for that person and organization

  @unit
  Scenario: A join at the cut-off is tracked as joined_organization, one a millisecond earlier is not
    Given a join that occurred at exactly 2026-11-06T00:00:00.000Z, and one at 1 ms earlier
    When each is decided
    Then the first is tracked joined_organization and the second is not

  @unit
  Scenario: A large organization's members go out in batches of one hundred
    Given org-1 has 250 active members
    When a trace_received signal of project-1 is delivered
    Then Customer.io receives three batch requests holding 250 identifies

  @unit
  Scenario: Removed and deactivated members get nothing
    Given organization's active-member list no longer holds admin-1
    When a trace_received or coding_session_stored signal naming admin-1 is delivered
    Then Customer.io identifies member-2 alone

  @unit
  Scenario: A project its owners do not place tells only the admin it names
    Given the owners hold no organization for the project
    When a trace_received signal is delivered
    Then Customer.io identifies the signal's admin alone
