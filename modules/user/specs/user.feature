Feature: Canonical user lifecycle

  @unit
  Scenario: Deactivating a user invalidates every session family
    When the User service deactivates an active user
    Then the user is marked deactivated
    And browser sessions are revoked
    And CLI tokens are revoked

  Scenario: Changing an email refreshes authenticated identity
    When an authorized transport changes a user's normalized email through the User service
    Then the profile is updated
    And browser sessions are revoked

  @unit
  Scenario: Uploading an avatar uses the personal workspace
    Given a valid avatar image
    When the User service sets the avatar
    Then Organization supplies the user's personal project
    And the bytes are stored with the user-avatar purpose
    And the User service stores the compatibility delivery URL

  Rule: Every backend the feature stores accounts in answers the same way

    @unit
    Scenario: The memory and Postgres user repositories answer alike
      Given the same accounts written to each backend
      When the same reads and writes run against every backend
      Then each answers the same profiles, the same absences, and the same refusal of a second first password

    @unit
    Scenario: The memory and Postgres credential repositories answer alike
      Given a person holding one sign-in method in each backend
      When the same reads and writes run against every backend
      Then each refuses to unlink the last method, lists the method without its password, and stores a rotated hash on the same row

    @unit
    Scenario: An organization's email domains count its own members only
      Given accounts on two company domains, only some of them members of the organization
      When the email domains are counted for that organization's members
      Then each domain counts only the members on it, case aside
      And no address leaves the module

  # The stored password hash is the one column in this feature that must not
  # travel. It used to: the API process read it on its own connection and the
  # comparison happened in a transport, which meant the rule about that column
  # lived nowhere in particular.
  @integration
  Scenario: Credential password hashes never leave the user feature
    Given a signed-in person who holds a credential sign-in method
    When they change their password
    Then the current password is verified and the new one stored in one operation
    And the stored hash is read and written by the User feature's own persistence
    And the process composing the request never reads the account rows itself
    And what the operation answers with is the outcome, never the stored hash

  # There was no way to end a session anywhere in the product: somebody who
  # signed in on a shared machine, lost a laptop or suspected a stolen cookie
  # had no action available, and the account surface offered none.

  @unit
  Scenario: The account surface serves the browsers somebody is signed in on
    Given a signed-in person holding several browser sessions
    When they open their account's devices list
    Then the browsers are served under the user namespace with their sign-in method and last activity
    And the browser making the request is marked as the current one

  @unit
  Scenario: Ending one browser session is a mutation on the caller's own account
    Given a signed-in person reading their devices list
    When they end one of the other browsers
    Then that session alone is ended
    And the request names no account, so nobody else's session is reachable

  # main's #7631 hardening: the personal context is readable with
  # organization:view, so the project's API key needs project:manage.
  @unit
  Scenario: A caller who may manage their personal project reads its API key in the personal context
    Given a member holding project:manage on their personal project
    When they read their personal context in that organization
    Then the personal project's API key is returned

  @unit
  Scenario: A caller who may not manage their personal project reads a blank API key in the personal context
    Given a member without project:manage on their personal project
    When they read their personal context in that organization
    Then the personal project's API key is blank
    And the blank key is a valid personal context on the wire

  # main's user.personalUsage, budgetOverview and cliBootstrap, served from
  # Enterprise governance. personalUsage checked membership before reading.
  @unit
  Scenario: A caller outside the organization cannot read a personal usage rollup
    Given a user who is not a member of the organization
    When they read their personal usage in that organization
    Then the read is refused as not a member of the organization
    And no usage is read

  @unit
  Scenario: A member's personal usage reads their own rollup over the window they gave
    Given a member of the organization
    When they read their personal usage with a window start and end
    Then governance reads the rollup for that member over that window

  @unit
  Scenario: A member's budget overview lists their own budgets with top models when asked
    Given a member of the organization
    When they read their budget overview asking for top models
    Then governance reads the overview for that member with top models

  @unit
  Scenario: The CLI login ceremony reads the caller's own bootstrap
    Given a member of the organization
    When the CLI asks for its bootstrap
    Then governance resolves the bootstrap for that member
