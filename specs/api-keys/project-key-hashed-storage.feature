Feature: Project API keys are stored as hashes
  As a LangWatch operator
  I want the project API key stored only as an HMAC, like every other API key
  So that a copy of the database does not hand out working credentials

  The project API key used to be stored in plaintext. It is now stored as an
  HMAC-SHA256 keyed by the API key pepper (CREDENTIALS_SECRET, falling back to
  NEXTAUTH_SECRET), plus its last four characters for display. A key that was
  stored before this change keeps working: the maintenance sweep hashes it,
  and clears its plaintext a grace window later so the previous release can
  still authenticate it during a rolling deploy or a rollback.

  LangWatch's own services (the workflow engine, scenario runs, the AI
  gateway's trace export, the checkup canaries and MCP sessions) no longer
  borrow the project API key. They authenticate with a separate project
  internal key that never leaves the server.

  Background:
    Given a project in an organization

  # Authentication with a key stored before the change

  @integration
  Scenario: A key stored in plaintext authenticates before the sweep runs
    Given the project API key is stored only in plaintext
    When a request authenticates with that key
    Then the request is authenticated as the project
    And the key's hash is stored on the project

  @integration
  Scenario: A key authenticates after the sweep hashed it
    Given the project API key is stored only in plaintext
    When the maintenance sweep runs
    Then the key's hash and last four characters are stored
    And a request with that key is authenticated as the project

  @integration
  Scenario: A key authenticates after its plaintext was cleared
    Given the project API key was hashed longer ago than the grace window
    When the maintenance sweep runs
    Then the plaintext of the key is no longer stored
    And a request with that key is authenticated as the project

  @integration
  Scenario: The plaintext stays during the grace window
    Given the project API key was hashed less than the grace window ago
    When the maintenance sweep runs
    Then the plaintext of the key is still stored

  @integration
  Scenario: A wrong key is refused
    When a request authenticates with a key that belongs to no project
    Then the request is not authenticated

  @integration
  Scenario: A key of an archived project is refused
    Given the project is archived
    When a request authenticates with the project API key
    Then the request is not authenticated

  @integration
  Scenario: A rotation made by the previous release retires the old key
    Given the project API key was hashed
    And a pod of the previous release rotates the key by writing a new plaintext
    When a request authenticates with the old key
    Then the request is not authenticated
    And a request with the new key is authenticated as the project

  # New and rotated keys

  @integration
  Scenario: A new project stores only the hash of its key
    When a project is created
    Then the project stores the hash and last four characters of its key
    And no plaintext key is stored

  @integration
  Scenario: Rotating the key returns the new key once and stores only its hash
    When an admin rotates the project API key
    Then the new key is returned in the rotation response
    And only the hash and last four characters of the new key are stored
    And the previous key no longer authenticates

  # The internal key

  @integration
  Scenario: The internal key authenticates as the project
    When a LangWatch service asks for the project internal key
    And a request authenticates with that key
    Then the request is authenticated as the project

  @integration
  Scenario: The internal key survives a rotation of the project API key
    Given a LangWatch service holds the project internal key
    When an admin rotates the project API key
    Then the internal key still authenticates as the project

  @integration
  Scenario: Concurrent requests for the internal key get the same key
    When two LangWatch services ask for the project internal key at once
    Then both receive the same key

  @integration
  Scenario: The Python SDK login accepts the key a person mints for one project
    Given a member mints an API key bound to one project from the authorize page
    When the SDK validates that key
    Then it is accepted
    And the response names that project

  # Display

  @integration
  Scenario: The settings page shows only the last four characters
    Given I administer the project
    When I open Settings > API Keys
    Then the project API key row shows only the last four characters of the key
    And the row offers to rotate the key, not to reveal or copy it

  # Keys handed to a person
  #
  # The project API key cannot be handed out once it is stored as a hash. The
  # places that handed it to a person (CLI login, `langwatch login --project`,
  # `langwatch langy`) hand the person an API key of their own instead: owned
  # by them, an Admin binding on the one project, the shape the API keys page
  # creates. Bound to one project, it authenticates without a project id, so a
  # CLI that only writes LANGWATCH_API_KEY keeps working. A device session's
  # key is minted under the session's login key and dies with the session; a
  # key written to a .env is long-lived and revoked from the API keys page.
  # The token is held encrypted in a time-limited cache so a repeat request
  # re-sends it instead of minting another key; nothing in Postgres can
  # reproduce it.

  @integration
  Scenario: the key a CLI login hands out is the person's own, bound to the one project
    When a device login delivers the personal project
    Then the delivered key is owned by the person with an Admin binding on that project only
    And it is minted under the session's login key

  @integration
  Scenario: the handed-out key authenticates as its project without a project header
    When a request authenticates with the delivered key and names no project
    Then the request is authenticated as the key's project

  @integration
  Scenario: no plaintext key is stored with the device login
    When a device login delivers a key
    Then no Redis record holds that key in plaintext

  @integration
  Scenario: a CLI project login receives an API key of the person's own, never the project key
    Given a device code approved for a project login
    When the CLI exchanges it
    Then the response carries an API key of the person's own, bound to the project
    And the project API key is not returned

  @integration
  Scenario: asking again for the same project re-sends the key instead of minting another
    When the same device asks twice for a key for one project
    Then both answers carry the same key

  @integration
  Scenario: a key revoked from the API keys page is never re-sent
    Given the device holds a key for the project
    When the person revokes it and the device asks again
    Then a new key is minted and returned

  @integration
  Scenario: a new login from the same device retires the previous session's project key
    Given a device session holds a key for its personal project
    When the person logs in again from the same device
    Then the previous session's key is revoked with its login key

  @integration
  Scenario: a superseded session gets no key for its personal project
    Given a newer login from the same device replaced a session
    When the older session asks for its personal project
    Then the project is returned without a key

  @integration
  Scenario: The application payload carries no project key material
    When the application loads my organizations and projects
    Then no project API key, key hash or internal key is included in the payload
