Feature: Docs session keys for the documentation playground
  A signed-in member lets the docs playground act as them in one project for five
  minutes, without the docs ever holding their session. See ADR-185.

  @integration
  Scenario: A member grants the docs their access to one project
    Given a member signed in to the app with access to two projects
    And the docs origin that opened the consent page is registered
    When they choose one project and allow access
    Then a docs session key is minted for that project only
    And it expires within five minutes, or sooner when their session or the organisation's session ceiling ends first
    And it is hidden from the API keys page and refuses customer edits

  @integration
  Scenario: A docs session key can do exactly what the member can do in its project
    Given a docs session key for a project
    When it calls an endpoint the member may call in that project
    Then the call succeeds
    When it calls an endpoint the member may not call, or any endpoint for another project
    Then the call is refused with status 403
    When the member loses a permission or leaves the project
    Then the key's next call that needs it is refused

  @unit
  Scenario: The consent page refuses an unregistered docs origin
    Given a consent request from an origin that is not registered for docs
    When the consent page loads
    Then it explains that this site cannot connect to LangWatch
    And no key can be minted for that origin

  @unit
  Scenario: No docs session key is minted while an operator acts as another member
    Given an operator impersonating a member
    When the consent page asks to mint a docs session key
    Then permission_denied is returned with status 403
    And no key is minted

  @unit
  Scenario: A member who denies access mints nothing
    Given the consent page is open
    When the member denies access
    Then no key is minted
    And the docs are told the request was denied

  @integration
  Scenario: Disconnecting revokes the docs session key
    Given a member's docs session key
    When the docs ask to revoke it with the key itself
    Then the key stops authenticating
    And revoking it again succeeds without saying whether it existed

  @integration
  Scenario: Signing out of the app revokes every docs session key the session minted
    Given two docs session keys minted by one browser session
    When the member signs out, or the session is revoked
    Then both keys stop authenticating
    And keys minted by the member's other sessions keep working until they expire

  @integration
  Scenario: The API answers cross-origin calls only from registered docs origins
    Given a registered docs origin and an unregistered origin
    When each sends a preflight for a REST call with an X-Auth-Token header
    Then the registered origin is allowed, without credentials
    And the unregistered origin gets no CORS allowance
