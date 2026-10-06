Feature: Canonical user lifecycle

  @unit
  Scenario: Deactivating a user invalidates every session family
    When the User service deactivates an active user, by self-service or through the user operation an operator calls
    Then the user is marked deactivated
    And browser sessions are revoked
    And CLI tokens are revoked

  @unit
  Scenario: Deactivation ends access even when user's fact cannot be sent
    Given user's lifecycle fact cannot be sent
    When the User service deactivates an active user
    Then the request fails
    And browser sessions and CLI tokens were already revoked

  @unit
  Scenario: A user's lifecycle fact carries the time the database recorded
    When the User service deactivates and then reactivates an account
    Then the deactivation date and each fact's instant come from the database's clock
    And never from the clock of the server that handled the request

  @unit
  Scenario: An operator authz has not yet heard is deactivated does not count as active
    Given two platform operators, one already deactivated in user's own records
    And authz still lists both
    When the User service deactivates the other
    Then it is refused with code user_last_platform_operator

  @integration
  Scenario: Two operators deactivated at once cannot leave none active
    Given two active platform operators
    When both are deactivated by concurrent requests
    Then one is deactivated and the other is refused
    And one active operator remains

  @unit
  Scenario: A lookup by address never guesses between case-twins
    Given accounts whose addresses differ only in case
    When an account is looked up by address
    Then the account holding the address exactly is answered
    And with no exact holder the lookup is refused with code user_email_ambiguous
    And the address still counts as taken

  @unit
  Scenario: Deactivating the last active platform operator is refused
    Given a user is the only active platform operator
    When the User service deactivates them
    Then it is refused with code user_last_platform_operator
    And nothing is written or recorded
    And an operator is deactivated while another active operator remains

  @unit
  Scenario: An impersonated session cannot deactivate another account or reactivate any
    Given a platform operator impersonating a customer
    When they deactivate another account, or reactivate a deactivated one
    Then it is refused with code forbidden and the account is unchanged

  @unit
  Scenario: Deactivation and reactivation are recorded as user's facts
    When the User service deactivates and then reactivates an account
    Then each change is recorded on user's pipeline as "lw.user.deactivated" and "lw.user.reactivated"
    And each fact is keyed by the user and its instant, so a redelivery records nothing new

  @unit
  Scenario: A user's lifecycle fact records who made the change
    Given a platform operator
    When they deactivate or reactivate an account, directly or while impersonating its owner
    Then each fact carries the operator as its actor, in the grants ledger's shape
    And a fact recorded before actors existed still reads, with no actor

  # Product analytics belong to nurturing (CLAUDE.md rule 7): user records the fact, and
  # nurturing derives the signed_up milestone from it.
  @unit
  Scenario: A self-service registration is recorded as user's fact
    Given the auth provider is email
    When a registration succeeds through the register route
    Then exactly one "lw.user.registered" fact is recorded for the created user id
    And the fact is keyed by the user alone, so a redelivery records nothing new

  @unit
  Scenario: A refused registration records no registered fact
    Given the auth provider is email
    And a user already exists with that email
    When the registration is attempted
    Then no "lw.user.registered" fact is recorded

  @unit
  Scenario: A registration stands even when user's registered fact cannot be sent
    Given user's lifecycle fact cannot be sent
    When a registration succeeds through the register route
    Then the account is created and the registration answers it

  @unit
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

  # The personal context is a cached read, so it never carries a credential:
  # the page mints a personal access token instead of revealing a key.
  @unit
  Scenario: The personal context never carries the personal project's API key
    Given a member of the organization, with or without project:manage on their personal project
    When they read their personal context in that organization
    Then the personal project's API key is blank
    And the blank key is a valid personal context on the wire

  @integration
  Scenario: The personal OTLP panel offers a personal access token, shown once
    Given a member opens the personal OTLP endpoint panel
    Then the snippet shows "<YOUR_LANGWATCH_API_KEY>" and no key is read
    When they choose "Create a personal access token"
    Then an ingestion-only personal key on their personal project is minted
    And the panel says the token can only send data to this project and cannot read or change anything
    And the token fills the snippet while the panel is open and is held in memory only

  # main's user.personalContext and user.personalBudget read the gateway's
  # default routing policy, the caller's personal key and the budget check.
  @unit
  Scenario: The personal context names the default routing policy the gateway resolves
    Given a member whose personal team inherits a default routing policy
    When they read their personal context in that organization
    Then the personal context names that routing policy

  @unit
  Scenario: The personal budget warns at the gateway's soft warning on the caller's own key
    Given a member holding a personal gateway key whose budget is at a soft warning
    When they read their personal budget in that organization
    Then the gateway checks the budget against that key at no projected cost
    And the personal budget answers a warning with the spend and the limit

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

  # main's handler passed scope, scope id, limit, spend and period through
  # unchecked, and its mail rendered each one blank rather than refusing.
  @unit
  Scenario: A request whose scope, limit or spend is blank still emails the admin
    Given the page was opened with the scope, the scope ID, the limit or the spend left blank
    When the user clicks "Send request"
    Then the mutation resolves with the admin it was sent to
    And the email renders that field blank, with no share of the limit stated

  @unit
  Scenario: A blank field does not hide a delivery failure
    Given the page was opened with the limit and the spend left blank
    And the server names no public base URL to link the budgets page
    When the user clicks "Send request"
    Then the mutation refuses the request as not delivered
    And no email is sent
