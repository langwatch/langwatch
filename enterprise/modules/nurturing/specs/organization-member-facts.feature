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
  Scenario: A busy organization sends one batch per debounce window
    When traces of project-1 and project-2 are delivered inside 300 seconds
    Then each member is identified once
    And after 301 seconds each member is identified again with the later time

  @unit
  Scenario: A trace the organization's window drops still moves the stored time
    Given a trace of project-1 was just told to the members
    When a later trace of project-2 is delivered inside 300 seconds
    Then a person joining now gets the later last_trace_at

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
