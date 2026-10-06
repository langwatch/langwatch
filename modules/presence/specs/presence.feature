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

  # Project and organization own the presence settings; presence learns them only from their
  # facts (rulings 2026-10-05, "Presence"), so it holds no peer to ask.
  @unit
  Scenario: Presence keeps no project or user peer
    When a process installs presence
    Then presence names no peer it depends on
    And it decides whether a project is enabled from its own fold of the settings facts

  @unit
  Scenario: Presence folds the presence-setting facts project and organization append
    Given project has appended that a project was created
    And project has appended that the project's own presence setting is on
    When organization appends that the project's organization switched presence off
    Then presence's settings subscribers fold each fact
    And presence answers that the project is not enabled

  @unit
  Scenario: A heartbeat counts once presence has folded the project's creation
    Given a worker installs presence beside project's pipeline
    And project appends that a project was created
    When a browser session sends a heartbeat for that project
    Then the session is listed as present

  # Presence folds project's and organization's presence-setting facts into its own durable keys
  # (rulings 2026-10-05, "Presence flag"); answering from that fold, switching off is eventual.
  @unit
  Scenario Outline: A project is enabled only when its folded setting and its organization's are both on
    Given presence has folded the project's presence setting as "<project>"
    And it has folded the project's organization's presence setting as "<organization>"
    When presence decides whether the project is enabled
    Then it answers "<enabled>"

    Examples:
      | project | organization | enabled |
      | on      | on           | yes     |
      | on      | off          | no      |
      | off     | on           | no      |
      | off     | off          | no      |

  @unit
  Scenario: A project presence has folded no fact for is not enabled
    Given presence has folded nothing about a project
    When presence decides whether the project is enabled
    Then it answers that the project is not enabled

  @unit
  Scenario: A created project with no recorded settings is enabled, as the stored defaults are
    Given presence has folded a project's creation
    And it has folded no presence setting for the project or its organization
    When presence decides whether the project is enabled
    Then it answers that the project is enabled

  @unit
  Scenario: A presence setting older than the one folded does not overwrite it
    Given presence has folded a project's setting as off and its organization's as off
    When an older setting arrives turning each of them on
    Then presence still answers that the project is not enabled

  @unit
  Scenario: Folding the same presence-setting fact twice changes nothing
    Given presence has folded a project's setting as off
    When the same fact is delivered again
    Then presence still answers that the project is not enabled

  @integration
  Scenario: Folded presence settings are durable and outlive every session
    Given presence folds a project's and an organization's setting into Redis
    When the keys are inspected
    Then neither key carries an expiry
    And presence answers from them after a fresh repository reads them

  # The presenter is the existing session-person fact the door binds, with image (rulings
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
