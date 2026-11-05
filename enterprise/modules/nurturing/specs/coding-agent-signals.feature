Feature: Coding-agent session signals reach Customer.io

  Coding-agent records one session-stored fact per stored session. Nurturing
  reacts to it from its own side and tells Customer.io about the organization's
  admin: the active-day count and the first session's event. The last session
  time, the agent types, the terminal types, the repo count, the first session's
  time and the first-three-days count reach every active member: see
  organization-member-facts.feature. Nurturing alone keeps this state, on its
  own organization row.

  Background:
    # Days are UTC calendar days counted from the organization's creation.
    Given nurturing knows organization org-1 with admin admin-1 and project project-1

  @unit
  Scenario: The first coding-agent session raises one first-session signal
    When coding-agent's session-stored fact says the session is the project's first
    Then one first-session signal names the admin, the project and the agent
    And the active-day count is one

  @unit
  Scenario: A redelivered or second first-session fact raises no second signal
    Given the organization's first session was already recorded
    When another session-stored fact says first, from the same or another project, or at once
    Then no second first-session signal is raised

  @unit
  Scenario: A second agent type extends the list without a first-session signal
    Given the organization's first session used claude_code
    When a later session used codex
    Then the agent types are claude_code and codex
    And no second first-session signal is raised

  @unit
  Scenario: The first session names every agent type of its batch
    When one batch holds sessions of claude_code and codex and the first is the project's first
    Then the first-session signal names claude_code and codex

  @unit
  Scenario: The first session carries every active member of the organization
    When the first coding-agent session is raised
    Then the first-session signal carries every active member of the organization

  @unit
  Scenario: A delivery that fails before it is claimed is not lost when the fact is redelivered
    Given delivering a signal fails once, before the delivery claim is taken
    When the same session-stored fact is delivered again
    Then the signal is sent exactly once

  @unit
  Scenario: The owners' first project is read only for a first session
    When a session-stored fact says first is false
    Then the organization's first project is not read

  @unit
  Scenario: Every member of an organization that sends a coding-agent session gets uses_coding_agent in Customer.io
    Given the first-session signal carries the members admin-1 and member-2
    When the first-session signal is delivered, then delivered again
    Then Customer.io identifies uses_coding_agent=true for each member once
    And a member of a second organization is identified once too
    # Known limit: the member list is read once, so a member who joins later is not identified.
    # Known limit: a member whose own claim throws is not retried; the delivery claim drops the redelivery.

  @unit
  Scenario: A member claim that fails never strands a member already claimed
    Given the claim for the second member throws
    When the first-session signal carrying two members is delivered
    Then the first member is still identified with uses_coding_agent=true

  @unit
  Scenario: A member who chose another integration method in onboarding keeps it
    Given member-2 chose the platform integration method in onboarding
    When the first-session signal carrying member-2 is delivered
    Then Customer.io identifies member-2 with uses_coding_agent=true
    And integration_method is never sent for member-2 again, so it stays platform

  @unit
  Scenario: A seeded organization never gets the first-session signal
    Given the organization was learned from project's backfill
    When a session-stored fact says first
    Then no first-session signal is raised
    And the active-day count is one

  @unit
  Scenario: A session that is not the project's first raises no first-session signal
    When a session-stored fact says first is false
    Then no first-session signal is raised
    And the active-day count is one

  @unit
  Scenario: Active days count one per later UTC day
    When sessions occur on days D, D, D+1 and D+3
    Then the counts raised are one, two and three

  @unit
  Scenario: A session just before and just after UTC midnight counts as two days
    When sessions occur at 23:59 and 00:01 UTC
    Then the active-day count is two

  @unit
  Scenario: One batch over midnight counts both of its days
    Given the organization's last active day is D-1
    When one batch holds sessions at 23:59 on D and 00:01 on D+1
    Then the active-day count grows by two

  @unit
  Scenario: A late session of an earlier day changes nothing
    Given the organization's last active day is D+3
    When a session of day D+2 arrives
    Then no active-day signal is raised

  @unit
  Scenario: An organization with no admin raises nothing
    Given the organization has no admin
    When a session-stored fact arrives
    Then no signal is raised

  @integration
  Scenario: Concurrent first-session writes change the row once
    Given five first-session writes at once
    Then exactly one reports first

  @unit
  Scenario: A stored session identifies coding_last_session_at on the admin
    Given the owners hold no organization for the project
    When a coding_session_stored signal is delivered
    Then Customer.io identifies the admin with coding_last_session_at in Unix seconds

  @unit
  Scenario: Session updates to Customer.io are debounced per project for 300 seconds
    Given the owners hold no organization for the project
    When sessions of one project are delivered inside 300 seconds
    Then Customer.io is identified once
    And after 301 seconds it is identified again with the later time

  @unit
  Scenario: A later UTC day raises coding_active_days
    When a coding_active_days signal is delivered
    Then Customer.io identifies the admin with the count

  @unit
  Scenario: A second agent type extends coding_agent_types without a first-session event
    When a coding_agent_types signal is delivered
    Then Customer.io identifies the full list
    And no event is tracked

  @unit
  Scenario: The first coding-agent session identifies the admin and tracks one event
    When a coding_agent_first_session signal is delivered
    Then Customer.io identifies coding_first_session_at in Unix seconds and coding_agent_types
    And tracks one coding_agent_first_session with the agent type

  @unit
  Scenario: The new signals reach Customer.io only
    When any of the new signals is delivered
    Then PostHog receives nothing

  @unit
  Scenario: A new terminal type raises the full sorted list of terminal types
    Given the organization's sessions ran in vscode
    When a later session ran in ghostty
    Then the terminal types raised are vscode, then ghostty and vscode

  @unit
  Scenario: A known terminal type raises no second terminal-types signal
    Given the organization's sessions ran in vscode
    When another session ran in vscode
    Then one terminal-types signal has been raised

  @unit
  Scenario: A new repo grows the organization's repo count
    When sessions of two projects of the organization name two repos
    Then the repo counts raised are one and two

  @unit
  Scenario: A repo seen again does not grow the repo count
    Given a project's session named a repo
    When a session of another project of the organization names the same repo
    Then one repo-count signal has been raised

  @unit
  Scenario: The repo keys an organization holds stop at the cap
    Given an organization holding the most repo keys it may
    When a session names one more repo
    Then no further key is held and the count stays at the cap

  @unit
  Scenario: A session with no terminal type or no repo changes neither value
    Given the organization's sessions named a terminal type and a repo
    When a session names neither
    Then no further terminal-types or repo-count signal is raised
    And an organization with only such sessions gets neither signal

  @unit
  Scenario: A delivery of the new facts that fails is not lost when the fact is redelivered
    Given delivering the repo-count signal fails once
    When the same session-stored fact is delivered again
    Then the repo-count signal is sent exactly once

  @unit
  Scenario: The repo key never reaches a signal
    When a session-stored fact names a repo key
    Then no raised signal holds the key

  @unit
  Scenario: The terminal types and repo count go to whoever gets the agent types
    When a session-stored fact names a terminal type and a repo
    Then the terminal-types and repo-count signals name the person the agent-types signal names

  @unit
  Scenario: A terminal-types signal identifies the full list without an event
    When a coding_terminal_types signal is delivered
    Then Customer.io identifies the full list
    And no event is tracked

  @unit
  Scenario: A repo-count signal identifies the count and nothing else
    When a coding_repo_count signal is delivered
    Then Customer.io identifies coding_repo_count with the count as the only trait
    And no event is tracked

  @unit
  Scenario: The terminal types and repo count are not debounced, like the agent types
    When two signals of a kind with different values are delivered inside 300 seconds
    Then Customer.io is identified with both

  @integration
  Scenario: Concurrent writes hold one terminal type and one repo key once
    Given five writes of one terminal type and five of one repo key at once
    Then the organization holds each once

  @unit
  Scenario: Sessions on days 0, 1 and 2 count as one, two and three
    Given the organization was created on day 0
    When sessions occur on days 0, 1 and 2
    Then the first-three-days counts raised are one, two and three

  @unit
  Scenario: Two sessions on one day count once
    Given the organization was created on day 0
    When two sessions occur on day 1
    Then one first-three-days signal with the count one is raised

  @unit
  Scenario: Days are UTC calendar days from the organization's creation
    Given the organization was created at 23:00 UTC on day 0
    When a session occurs at 23:30 on day 0 and another at 00:30 UTC on day 1
    Then the first-three-days count is two

  @unit
  Scenario: A session of an earlier day arriving after a later day still counts
    Given a session of day 2 was counted
    When a session of day 0 arrives, still on day 2
    Then the first-three-days counts raised are one and two

  @unit
  Scenario: A session after day 2 does not grow the first-three-days count
    Given a session of day 0 was counted
    When a session occurs on day 3
    Then one first-three-days signal has been raised

  @unit
  Scenario: A session of day 2 handled after day 2 raises nothing
    Given it is day 3
    When a late session dated day 2 arrives
    Then no first-three-days signal is raised

  @unit
  Scenario: An organization whose first session comes after day 2 never gets the first-three-days count
    Given the organization was created on day 0
    When its first session occurs on day 5
    Then no first-three-days signal is raised
    But the active-day count is one

  @unit
  Scenario: A session dated before the organization's creation does not count
    Given the organization was created on day 0
    When a session is dated the day before
    Then no first-three-days signal is raised

  @unit
  Scenario: An organization whose creation is unknown gets no first-three-days count
    Given the owners hold no creation time for the organization
    When a session-stored fact arrives
    Then no first-three-days signal is raised

  @unit
  Scenario: A first-three-days delivery that fails is not lost when the fact is redelivered
    Given delivering the first-three-days signal fails once
    When the same session-stored fact is delivered again
    Then the first-three-days signal is sent exactly once

  @unit
  Scenario: The first-three-days count goes to whoever gets the agent types
    When a session-stored fact arrives on day 0
    Then the first-three-days signal names the person the agent-types signal names

  @unit
  Scenario: An organization's creation is read once while the service holds it
    Given a batch of sessions read the organization's creation
    When later batches of the organization arrive
    Then the creation is not read again
    And a session past day 2 still raises no first-three-days count

  @unit
  Scenario: A first-three-days signal identifies the count without an event
    When a coding_session_days_first_3 signal is delivered
    Then Customer.io identifies coding_session_days_first_3 with the count
    And no event is tracked

  @integration
  Scenario: Concurrent writes of one day count it once
    Given five writes of one day offset at once
    Then the first-three-days count is one

  @integration
  Scenario: Nurturing reads an organization's creation through its share
    Given an organization its owners hold
    Then nurturing reads when it was created
    And it reads null for an organization they do not hold

  # A person's own coding facts: set only on the profile of a personal project's
  # owner. A shared project's stored session names no LangWatch user, so it sets
  # no own fact for anyone.

  @unit
  Scenario: A personal project's session tells only its owner own_coding_last_session_at
    Given project-1 is the personal project of member-2, and admin-1 is also a member
    When coding-agent stores a session for project-1
    Then one own-session signal names member-2
    And admin-1 gets no own-session signal

  @unit
  Scenario: A session in another member's personal project sets only that member's own traits
    Given project-1 is the personal project of admin-1 and project-2 that of member-2
    When coding-agent stores a session for project-2
    Then the own-session signal names member-2 only

  @unit
  Scenario: A shared project's session sets no own coding trait
    Given project-1 is a shared project
    When coding-agent stores a session for project-1
    Then no own-session signal is raised

  @unit
  Scenario: A deactivated owner gets no own coding trait
    Given project-1 is the personal project of a person who is not an active member
    When coding-agent stores a session for project-1
    Then no own-session signal is raised

  @unit
  Scenario: Own session updates are debounced per person for 300 seconds
    When the owner's sessions from two projects are delivered inside 300 seconds
    Then Customer.io identifies own_coding_last_session_at on the owner once

  @unit
  Scenario: A person's own first session is set once across organizations
    Given the owner's first own session was delivered
    When a session of the owner's personal project in another organization is delivered later
    Then own_coding_first_session_at keeps the first recorded time
    And own_coding_last_session_at moves to the later time

  @unit
  Scenario: Own coding traits reach Customer.io only, with no event
    When an own-session signal is delivered
    Then PostHog receives nothing
    And Customer.io tracks no event

  @unit
  Scenario: A failed first-session send gives its claim back
    Given Customer.io rejects the owner's own_coding_first_session_at
    When an own-session signal is delivered
    Then the owner's first-session claim is given back
    And the owner's next session sets own_coding_first_session_at
