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
    Then exactly one "lw.user.registered" fact is committed with the account, after its created fact
    And the fact names the credential row it opened, its creation time and the address
    And the fact is keyed by the user alone, so a redelivery records nothing new

  @unit
  Scenario: A refused registration records no registered fact
    Given the auth provider is email
    And a user already exists with that email
    When the registration is attempted
    Then no "lw.user.registered" fact is recorded

  # Round 35 (Alex, 2026-10-08): a mint's and a registration's facts commit with the account
  # through user's fact outbox, so a down event bus never fails the request nor loses the fact.
  @unit
  Scenario: A registration stands even when the event bus is down
    Given the event bus cannot take user's facts
    When a registration succeeds through the register route
    Then the account is created and the registration answers it
    And its created and registered facts wait in the fact outbox

  @unit
  Scenario: Every account mint records user's created fact
    When an account is minted by the directory (SSO, OAuth, SCIM), a credential, a passkey or a registration
    Then exactly one "lw.user.created" intent is committed to user's fact outbox with the account row, carrying no address or name
    And it is keyed by the user alone, so a redelivery or the seed step records nothing new

  @unit
  Scenario: A mint answers while the event bus is down
    Given the event bus cannot take user's facts
    When an account is minted
    Then the account is created and its created fact waits in the fact outbox

  @unit
  Scenario: A mint whose fact cannot be committed writes no account
    Given the fact outbox row cannot be written
    When an account is minted
    Then the mint fails and its transaction rolls back, leaving no account

  @unit
  Scenario: The fact outbox records each committed fact on user's pipeline
    Given created, registered or erased intents committed to user's fact outbox
    When the worker's outbox delivers them, however often the write appended them
    Then each is recorded once on user_lifecycle with the data its write committed
    And a delivery while the bus is down throws, so the outbox retries it

  @unit
  Scenario: The seed step records a created fact for every existing account
    Given accounts stored before user recorded created facts
    When the background step "user:record-created-facts" runs, or resumes from its checkpoint
    Then each account after the checkpoint is recorded once as created, marked backfilled, at its row's creation time
    And the step waits until no older image that mints accounts without the fact still serves

  @unit
  Scenario: The seed step's dry run records nothing
    When the step runs as a dry run
    Then it reports how many accounts it would record, records no fact and saves no checkpoint

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

  # Account adoption (rulings 2026-10-06, Auth 32): an address proof adopts an
  # unfinished account. Every sign-in method on it was set before the proof, so
  # all of them go; what an invitation gave it stays.
  @integration
  Scenario: Adopting an unfinished account confirms it and drops its pre-proof sign-in methods at once
    Given an account awaiting confirmation that was never signed into
    And it holds a password, another linked sign-in method and a passkey
    And an invitation already made it a member of an organization
    When an address proof adopts it
    Then in one transaction the address is confirmed and every one of those sign-in methods is gone
    And its organization membership is kept

  @integration
  Scenario: Adoption refuses an account that is confirmed or has been signed into
    Given an account that is confirmed, or one awaiting confirmation that has been signed into
    When an address proof asks to adopt it
    Then the answer names why, and nothing about the account changes

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

  @integration
  Scenario: The personal OTLP panel offers a personal access token, shown once
    Given a member opens the personal OTLP endpoint panel
    Then the snippet shows "<YOUR_LANGWATCH_API_KEY>" and no key is read
    When they choose "Create a personal access token"
    Then an ingestion-only personal key on their personal project is minted
    And the panel says the token can only send data to this project and cannot read or change anything
    And the token fills the snippet while the panel is open and is held in memory only

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

  # Organization records a seat taken away; user ends that person's browser sessions from its own
  # side, eventually, while authorization refuses them at once (ruling R7).
  Rule: A seat taken away in an organization ends the person's browser sessions

    @unit
    Scenario: A member disabled in an organization loses their browser sessions
      Given organization has recorded a member as disabled
      When user receives that fact
      Then every browser session that person holds is ended

    @unit
    Scenario: A redelivered seat revocation is keyed alike and harmless
      Given organization's member-disabled fact was already handled
      When the same fact is delivered again
      Then both deliveries share one deduplication key
      And ending the sessions again leaves the account with none

  # Round 48 (A1-a): the switches are shared deployment facts, so user asks no peer for them.
  Rule: User reads the sign-in capability switches from the deployment facts auth reads

    @unit
    Scenario: User reads the passkey, two-step and own-password switches as auth does
      Given a deployment that sets PASSKEYS_ENABLED, MFA_ENROLLMENT_OPEN and LOCAL_PASSWORDS_ENABLED
      When user's configuration is parsed beside another reader of the same switches
      Then user reads the same values that reader does
      And no switch is claimed twice

    @unit
    Scenario: A capability switch written a way nothing reads refuses the boot
      Given a deployment that sets one of the switches to a value outside "on" and "off"
      When user's configuration is parsed
      Then the boot is refused rather than the surface left quietly off
