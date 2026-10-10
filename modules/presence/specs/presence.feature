Feature: Collaborative presence
  Presence state and cursor fanout are owned by one process-composed service.

  @unit
  Scenario: A first heartbeat joins a project
    Given presence is enabled for the project
    And the browser session is not currently present
    When the session sends a heartbeat
    Then the service stores the session with a bounded TTL
    And it publishes one join delta

  @unit
  Scenario: An unchanged heartbeat refreshes only the TTL
    Given the browser session is already present at the same location
    When the session sends another heartbeat
    Then the service refreshes the stored session
    And it publishes no duplicate delta

  @unit
  Scenario: Leaving twice is idempotent
    Given a browser session has already left
    When the leave operation is delivered again
    Then the service reports success
    And it publishes no second leave delta

  # Every project member holds the permission presence takes, so the permission is not what
  # separates one member's published session from another's: ownership is.
  @unit
  Scenario: A member cannot remove another member's presence session
    Given another member of the project is present in a browser session
    When I ask to remove that member's session
    Then the removal is refused as not mine to make
    And that member stays present to everyone watching

  # Project and organization own the presence settings; presence reads their rows through
  # declared Postgres shares (round 46 E1, R40), so it holds no peer and keeps no copy.
  @unit
  Scenario: Presence keeps no project or user peer
    When a process installs presence
    Then presence names no peer it depends on
    And it decides whether a project is enabled by reading the owners' rows, not a fold of their facts

  # Over memory stores the owners' rows are a memory twin a test hands in (record §7).
  @unit
  Scenario: Over memory stores presence answers from a twin of the owners' rows
    Given a process boots presence over memory stores with no rows handed in
    When a browser session sends a heartbeat for a project
    Then presence answers that the project is not enabled
    And the session is not listed

  @unit
  Scenario Outline: A project is enabled only when its own setting and its organization's are both on
    Given project holds the project's presence setting as "<project>"
    And organization holds the project's organization's presence setting as "<organization>"
    When presence decides whether the project is enabled
    Then it answers "<enabled>"

    Examples:
      | project | organization | enabled |
      | on      | on           | yes     |
      | on      | off          | no      |
      | off     | on           | no      |
      | off     | off          | no      |

  @unit
  Scenario: A project its owner does not hold is not enabled
    Given project holds no project with that id
    When presence decides whether the project is enabled
    Then it answers that the project is not enabled

  @unit
  Scenario: A project whose team its owner does not hold is not enabled
    Given project holds the project in a team organization does not hold
    When presence decides whether the project is enabled
    Then it answers that the project is not enabled

  # Heartbeats are frequent, so presence keeps each answer in process for 30 s; the fold it
  # replaced was eventual too (coordinator, E1-presence attempt 2).
  @unit
  Scenario: A settings toggle may lag up to 30 seconds, and the next request after that sees it
    Given presence answered that a project is enabled
    When organization switches the project's organization's presence setting off
    Then within 30 seconds of that answer presence may still answer that the project is enabled
    And after 30 seconds the next request answers that the project is not enabled
    And a heartbeat for the project then stores no session

  @unit
  Scenario: Within the window presence reads the owners' rows once per project
    Given presence answered whether a project is enabled
    When further requests for the project arrive within 30 seconds
    Then presence answers them without reading the owners' rows again

  @integration
  Scenario: Presence reads the settings from project's and organization's rows
    Given a project stored by project with presence off, in a team under an organization with presence on
    When presence reads the project's settings
    Then it holds the project's setting as off and the organization's as on

  @integration
  Scenario: A project id its owner does not hold reads as unknown
    Given no project with that id in project's table
    When presence reads the project's settings
    Then the project is unknown

  # The presenter is the existing session-person context the door binds, with image (rulings
  # 2026-10-05, "Presence presenter"); presence keeps no user peer.
  @unit
  Scenario: The presenter's name and image come from the signed-in session
    Given I am signed in with a name and an avatar
    When my browser session sends a heartbeat
    Then the session peers see carries my authenticated id, my name and my avatar

  @unit
  Scenario: A caller with no session person is shown without a name or image
    Given the door binds no session person for my request
    When my browser session sends a heartbeat
    Then the session peers see carries my authenticated id with no name and no image

  @unit
  Scenario: Existing transports remain compatible
    Given a client calls the existing presence tRPC procedures
    When the compatibility router handles the request
    Then it delegates to the process-owned Presence service
    And existing procedure names and payloads remain unchanged

  @unit
  Scenario: A langy conversation update reaches only the project it was published for
    Given langy publishes a conversation update for one project through presence
    When a subscriber listens on that project's tenant emitter and another on a second project's
    Then only the first subscriber receives the update
    And the payload carries the conversation's owner, so langy's watch can drop it for other users

  # Presence is the one writer of the `broadcast:*` wire (record §3.3): trace and scenario publish
  # their tenant signals through it and keep no Redis broadcast of their own.
  @unit
  Scenario Outline: A peer's project signal reaches only the project it was published for
    Given a peer publishes a "<channel>" signal for one project through presence
    When a subscriber listens on that project's tenant emitter and another on a second project's
    Then only the first subscriber receives the signal

    Examples:
      | channel            |
      | trace_updated      |
      | discover_updated   |
      | simulation_updated |

  @unit
  Scenario: A tiered project signal is dropped once the project's allowance is spent
    Given a peer publishes many "delta" simulation signals for one project in a burst
    When the project's delta allowance runs out
    Then the signals past the allowance are dropped rather than relayed
