Feature: File reads answer through the installed stored-object module
  The process mounts the /api/files byte door over the one StoredObjectModule boot
  constructed; the caller is the project key the process's project door
  resolved (Alex, 2026-09-30: REST is the API key's), the read count comes from
  its rate limiter, and the key is pinned to its own project.

  @regression
  Scenario: the installed module answers a file read through the process's project door
    Given the stored-object module is installed over memory stores
    When a project key reads an object its project does not hold
    Then the route answers 404 not_found rather than failing inside the handler

  @regression
  Scenario: the installed module refuses a caller past its read allowance
    Given the stored-object module is installed over memory stores
    When a project key has spent the read allowance
    Then the route answers 429 rate_limited with a Retry-After hint

  @regression
  Scenario: the installed module refuses a file read with no key
    Given the stored-object module is installed over memory stores
    When the request carries a session cookie and no API key
    Then the door answers 401

  @regression
  Scenario: the installed module refuses a key of another project
    Given the stored-object module is installed over memory stores
    When a key for project B reads through a URL naming project A
    Then the route answers 403

  @regression
  Scenario: An unknown id on the legacy ClickHouse index answers not found, not unavailable
    Given the legacy stored_objects index is read through the tenant guard
    When the byte door reads an id that neither Postgres nor the index holds
    Then the read fails as stored_object_not_found, which the route answers 404

  @regression
  Scenario: Every legacy index statement declares itself unscoped
    Given the stored_objects table has no TenantId column
    When the repository sends any of its statements
    Then the tenant guard refuses it unless it declares why it is unscoped

  # Signed read URLs (Alex, 2026-09-30): REST is the key's and tRPC the session's, so the
  # browser asks tRPC for a short-lived URL whose signature is the credential.

  @integration
  Scenario: A signed-in viewer gets a read URL that serves the object's bytes
    Given a session viewer holding the object's purpose permission
    When they ask storedObjects.getReadUrl for the object
    Then the answer is a same-origin URL
    And a GET of that URL streams the bytes, on any storage backend

  @integration
  Scenario: A viewer is refused a read URL for another project's object
    Given a session viewer with no file-view permission on project B
    When they ask for a read URL for an object of project B
    Then the request is refused and no URL is minted

  @integration
  Scenario: A request without a session cannot mint a read URL
    Given a request carrying no session, such as one presenting only an API key
    When it asks storedObjects.getReadUrl for an object
    Then it is refused as unauthenticated

  @integration
  Scenario: A signed read URL refuses a tampered or expired signature
    Given a signed read URL whose signature was altered, names another object, is an upload seal, or has lapsed
    When it is fetched
    Then the answer is 401 and no bytes are served

  @regression
  Scenario: the installed module on memory stores refuses a signature written by hand
    Given the stored-object module is installed over memory stores
    When a read URL carries claims written by hand in place of a seal
    Then the route answers 401 and serves nothing
    And a seal made under the process's own random key shows no claim in the clear and opens
