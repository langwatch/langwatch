Feature: Canonical user lifecycle

  # Deactivation's door, its revokes and their order are auth's (D-A1U-5 revised):
  # modules/auth/specs/account-lifecycle.feature. User writes the row and records the fact.
  @unit
  Scenario: Deactivation writes the account and records no fact
    When the User service deactivates an active user
    Then the user is marked deactivated
    And no deactivation fact is recorded until the deactivation is recorded on its own

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

  # ops's platform-operator seed asks this before granting an unverified account (Rogerio, 2026-10-19).
  @unit @integration
  Scenario: The install's first-created account is answered by id
    Given accounts created one after another, some since deactivated
    When asked whether an account is the install's first-created one
    Then only the earliest-created account answers yes, deactivated or not
    And with no account at all none does

  # Addresses are stored lower-cased (Alex, 2026-10-13): every lookup is a plain match on the
  # unique index first; only a miss asks again case aside, for rows not lower-cased yet.
  @unit
  Scenario: Stored addresses are lower-cased
    When an account is minted, or its address changed, with capitals or spaces in the address
    Then the account stores the trimmed, lower-cased address

  @unit @integration
  Scenario: A mixed-case sign-in still finds the account
    Given an account whose address is stored lower-cased
    When it is looked up by the address typed with capitals
    Then that account is answered
    And the store is asked for the lower-cased address only, matched exactly

  @unit
  Scenario: An address stored with capitals still signs in
    Given an account stored with capitals that the address step has not reached, or an older image wrote
    When it is looked up by its address and no account holds the lower-cased form
    Then the lookup asks again case aside and answers the oldest such account
    And the address counts as taken

  @unit @integration
  Scenario: The address step lower-cases every stored address
    Given accounts stored with capitals before addresses were lower-cased
    When the background step "user:lower-case-stored-addresses" runs, as soon as the upgrade starts
    Then each such address is stored lower-cased, and a mixed-case lookup finds the account

  @unit @integration
  Scenario: A case-only duplicate is left as it is and reported
    Given another account already holds an address's lower-cased form
    When the address step runs
    Then the account keeps its address as it is, and the step logs it without the address
    And nothing is merged or removed
    And the step report on Ops > Upgrades lists the account with its address, for an admin to fix by hand

  @integration
  Scenario: The address step never overwrites a save made during its pass
    Given an address that changed after the step read it
    When the step writes
    Then the row keeps the newer address

  @unit
  Scenario: Running the address step twice changes nothing more
    Given the address step has run
    When it runs again
    Then it finds no address to change

  @unit
  Scenario: Deactivating the last active platform operator is refused
    Given a user is the only active platform operator
    When the User service deactivates them
    Then it is refused with code user_last_platform_operator
    And nothing is written or recorded
    And an operator is deactivated while another active operator remains

  @unit
  Scenario: An impersonated session cannot reactivate any account
    Given a platform operator impersonating a customer
    When they reactivate a deactivated account
    Then it is refused with code forbidden and the account is unchanged

  @unit
  Scenario: Deactivation and reactivation are recorded as user's facts
    When the User service deactivates an account, records the deactivation, and then reactivates it
    Then each change is recorded on user's pipeline as "lw.user.deactivated" and "lw.user.reactivated"
    And each fact is keyed by the user and its instant, so a redelivery records nothing new

  @unit
  Scenario: A user's lifecycle fact records who made the change
    Given a platform operator
    When an account's deactivation is recorded with them as the actor, and they reactivate it
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
  Scenario: A mint that loses a race for its address answers that the address is taken
    Given another mint of the same address committed first
    When the account is minted
    Then the mint is refused as email_already_registered rather than failing

  @unit
  Scenario: The fact outbox records each committed fact on user's pipeline
    Given created, registered or erased intents committed to user's fact outbox
    When the worker's outbox delivers them, however often the write appended them
    Then each is recorded once on user_lifecycle with the data its write committed
    And a delivery while the bus is down throws, so the outbox retries it

  # One pass over accounts in id order; each page is read once, its history read once, and its
  # commands sent as batches, created before standing. ARCHITECTURE.md, "Platform operators are a grant".
  @unit
  Scenario: The seed step records a created fact for every existing account
    Given accounts stored before user recorded created facts
    When the background step "user:record-created-facts" runs, or resumes from its checkpoint
    Then each account after the checkpoint is recorded once as created, marked backfilled, at its row's creation time
    And the step waits until no older image that mints accounts or changes their standing without the fact still serves

  @unit
  Scenario: The seed step sends each page as batches, every created fact before the page's standing facts
    Given stored accounts, some deactivated
    When the step runs
    Then each page of accounts is read once and sent as one batch of created facts followed by its batches of standing facts
    And an account's created fact is sent before its own deactivation or reactivation

  @unit
  Scenario: The seed step catches up a missed deactivation
    Given an account an older image deactivated without recording the fact
    When the step runs
    Then the account is recorded deactivated at its stored deactivation time

  @unit
  Scenario: The seed step repairs a missed reactivation
    Given an active account whose latest fact on user's own log is a deactivation
    When the step runs
    Then the account is recorded reactivated at the run's start
    And an active account whose log ends in a reactivation, or holds no deactivation, records nothing

  @unit
  Scenario: The created-facts step reads user's log from a process that only sends commands
    Given a process whose event store refuses every read, as the one running upgrade steps does
    And an account whose log holds a deactivation and then a reactivation
    When a page of accounts' standing facts is read
    Then they are answered through the event read seat in one read, oldest first, in each account's own tenant
    And the same read through the lifecycle pipeline's own event store is refused by name

  @unit
  Scenario: Running the seed step twice records once
    Given the step has run
    When it runs again
    Then no further created, deactivation or reactivation fact is recorded

  # A retried or restarted attempt resumes from the checkpoint; its report keeps the totals, so an
  # attempt that resumes at the end of the table reports every account, not none.
  @unit
  Scenario: A resumed seed step reports every account its attempts counted
    Given the seed step's checkpoint counted some accounts before its attempt stopped
    When the step resumes from that checkpoint
    Then each checkpoint it saves and the report it finishes with count on from those numbers

  @unit
  Scenario: The seed step resumes after the saved user id
    Given the step saved a checkpoint after a user id
    When it resumes
    Then it records only the accounts after that id
    And it saves the last id of each page it finishes

  @unit
  Scenario: The seed step's dry run records nothing
    When the step runs as a dry run
    Then it reports how many accounts it would record or re-state, sends no fact and saves no checkpoint

  @unit
  Scenario: Changing an email stores the normalized address
    When auth's door changes a user's email through the User service
    Then the profile holds the trimmed, lower-cased address
    And an unknown account is refused with code user_not_found
    And the sessions the old address outlives are auth's to end (modules/auth/specs/account-lifecycle.feature)

  @unit
  Scenario: Changing an email clears its verification
    Given a user whose address is verified
    When the User service changes the user's email to a different address
    Then the new address is stored as not verified
    And a change of letter case alone keeps the address verified

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
    Then the browsers are served under auth's namespace with their sign-in method and last activity
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

  # User reads project's own table through its declared share, never ProjectApi (ruling R40).
  @unit
  Scenario: The key's project door names the project from project's own table
    Given an API key that belongs to a project
    When the caller asks for the key's project
    Then the answer carries the project's id, name, slug and whether it is personal

  @unit
  Scenario: The key's project door refuses a key whose project row is gone
    Given an API key whose project no longer exists
    When the caller asks for the key's project
    Then the request is refused and names no project

  # Round 48 (A1-a): the switches are shared deployment facts, so user asks no peer for them.
  Rule: User reads the sign-in capability switches from the deployment facts auth reads

    @unit
    Scenario: User reads the passkey, two-step and own-password switches as auth does
      Given a deployment that sets PASSKEYS_ENABLED, MFA_ENROLLMENT_OPEN and LOCAL_PASSWORDS_ENABLED
      When user's configuration is parsed beside another reader of the same switches
      Then user reads the same values that reader does
      And no switch is claimed twice

    @unit
    Scenario: A capability switch written another way reads as the previous release read it
      Given a deployment that sets one of the switches to a value outside "on" and "off"
      When user's configuration is parsed
      Then the boot goes ahead
      And two-step enrolment and own passwords read it as off, and passkeys read it as on

  # Round 54 (O1-P2): a first visit can act before its personal project arrives; the server
  # answers the retryable "personal_workspace_pending" and the screen waits instead of failing.
  Rule: Personal actions wait while the personal workspace is being set up

    @integration
    Scenario: Issuing a personal key waits while the personal workspace is set up
      Given a first visit whose personal workspace is still being created
      When they issue a personal key on their settings
      Then no error is shown
      And the create action is disabled with a "Setting up your workspace" hint
      And the personal workspace is read again

    @integration
    Scenario: Saving a profile photo waits while the personal workspace is set up
      Given a first visit whose personal workspace is still being created
      When they save a new profile photo
      Then no error is shown
      And the save action is disabled with a "Setting up your workspace" hint
      And the personal workspace is read again

    @integration
    Scenario: Issuing a provider key from its tile waits while the personal workspace is set up
      Given a first visit whose personal workspace is still being created
      When they issue a virtual key from a model provider tile
      Then no error is shown
      And the issue action is disabled with a "Setting up your workspace" hint
      And the personal workspace is read again

    @unit
    Scenario: Uploading an avatar while the personal project is still being created
      Given a first visit whose personal workspace is still being created
      When they upload a new avatar
      Then it refuses with "personal_workspace_pending", a retryable handled error, and stores nothing

  Rule: The personal workspace offers the Langy ask only to a reader who may start a Langy turn

    @integration
    Scenario: A reader who may start a Langy turn is offered Explore via Langy on /me
      Given a reader holding "langy:create" where Langy is rolled out
      When the personal workspace host is asked whether the assistant can be asked
      Then it answers yes
      And asking it hands the prompt to Langy's ask

    @integration
    Scenario: A reader who may not start a Langy turn is not offered Explore via Langy on /me
      Given a reader without "langy:create", or where Langy is not rolled out
      When the personal workspace host is asked whether the assistant can be asked
      Then it answers no

  @integration
  Scenario: A person whose organization's single sign-on governs sign-in is not offered a passkey
    Given one of "ivy"'s confirmed addresses routes to "acme"'s single sign-on connection
    When "ivy" opens her Passkeys settings, or the account-security offer appears after sign-in
    Then neither offers to create a passkey
    And each says "Your organization's single sign-on handles sign-in for this account."
    And the offer still includes two-step verification when that is on offer

  @integration
  Scenario: A person whose organization's single sign-on governs sign-in is not offered a password
    Given one of "ivy"'s confirmed addresses routes to "acme"'s single sign-on connection
    And "ivy" holds no password
    When "ivy" opens her Password settings
    Then they do not offer to set a password
    And say "Your organization's single sign-on handles sign-in for this account."

  @integration
  Scenario: An account its single sign-on created is governed through its own address
    Given "ivy" signed up through "acme"'s single sign-on connection and has no address attached
    And her account address routes to that connection
    When "ivy" opens her Password settings
    Then they do not offer to set a password
