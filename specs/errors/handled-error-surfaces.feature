Feature: Knowable failures reach the customer as themselves
  As a customer who just hit a wall
  I want to be told what went wrong and what to do about it
  So that I can fix it myself instead of filing a ticket

  # These scenarios were written from a live UX pass over the platform after
  # the handled-error migration. Each one is a surface that was observed
  # degrading a knowable failure into "something went wrong", or offering an
  # escalation path for a failure the customer could resolve alone.

  # ---------------------------------------------------------------------------
  # The tRPC error-translating middleware
  #
  # tRPC v10's `next()` RESOLVES with `{ ok: false, error }` — it does not
  # throw. A middleware written as try/catch-around-next is therefore inert,
  # and every domain error it was meant to translate reaches the client as an
  # unknown 500. The unit test for the translating helper passes either way,
  # which is how this survived: the helper was correct and never wired to
  # anything that could reach it.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A domain error raised by the resolver is translated by the middleware
    Given a tRPC middleware that translates dataset domain errors
    When the resolver rejects with a dataset name conflict
    Then the caller receives the handled error for a taken dataset name
    And the failure does not degrade to an unknown server error

  @unit
  Scenario: A stale-columns conflict keeps its own code through the middleware
    Given a tRPC middleware that translates dataset domain errors
    When the resolver rejects with a stale-columns conflict
    Then the caller receives the handled error for stale dataset columns

  @unit
  Scenario: An infrastructure failure is left alone by the middleware
    Given a tRPC middleware that translates dataset domain errors
    When the resolver rejects with a dropped database connection
    Then the original failure is re-raised unchanged
    And it is not dressed up as a customer-actionable error

  @unit
  Scenario: A successful call passes through the middleware untouched
    Given a tRPC middleware that translates dataset domain errors
    When the resolver succeeds
    Then the caller receives the resolver's result

  # ---------------------------------------------------------------------------
  # Organization-scoped API authentication
  #
  # Authentication runs beneath the route family's own error handler, so its
  # refusals have to be answered in the shape that family publishes. A database
  # failure while loading the credential's organization is not a refusal: it
  # answers the family's authentication server error, and where the family owns
  # the response it is re-raised as it arrived rather than minted as handled.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A database failure loading the organization answers the family's server error
    Given an organization-scoped credential the resolver accepts
    When loading its organization fails on the database
    Then the caller receives the family's authentication server error
    And the request never reaches the route

  @unit
  Scenario: A database failure loading the organization is re-raised unchanged
    Given a family whose own error handler owns the response shape
    When loading the credential's organization fails on the database
    Then the original failure reaches that handler unchanged
    And it is not dressed up as a customer-actionable error

  # ---------------------------------------------------------------------------
  # Permission denials
  #
  # A denial is knowable and the caller can act on it (ask an admin), so it is
  # a handled error with a stable code. It was a plain Error whose MESSAGE a
  # route matched on to decide 403-vs-500 — so rewording the copy would have
  # silently turned every denial into a server fault.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A project permission denial names itself
    Given a user without the required permission on a project
    When the permission is required
    Then the failure carries the project permission denied code
    And it is attributed to the customer, not the platform
    And it names the permission that was required

  @unit
  Scenario: A denial is recognised without matching on its wording
    Given a file route that must tell a denial apart from an outage
    When a project permission denial reaches it
    Then the denial is recognised by its code
    And a dropped database connection is still treated as an outage

  # ---------------------------------------------------------------------------
  # The error id
  #
  # Offered on every failure, without exception. It was briefly withheld from
  # errors judged self-serviceable, which turned its presence into a signal —
  # so its absence became something the reader had to interpret — and failed
  # exactly the person looking at a screen we had classified wrongly.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The error id is offered on every failure
    Given a handled error the reader could resolve alone
    When the surface resolves what to render
    Then the error id is still offered

  @unit
  Scenario: A platform fault keeps its error id
    Given a handled error attributed to the platform
    When the surface resolves what to render
    Then the error id is offered as a support handle

  @unit
  Scenario: A failure with no copy for its code keeps its error id
    Given a handled error whose code the registry does not know
    When the surface resolves what to render
    Then the error id is offered as a support handle

  @unit
  Scenario: An unhandled failure keeps its error id
    Given a failure that was never handled
    When the surface resolves what to render
    Then the error id is offered as a support handle

  # ---------------------------------------------------------------------------
  # Inviting someone who is already here
  #
  # Observed: inviting an address already listed as an organization admin
  # created a pending invite row and said nothing at all.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Inviting an existing member is refused with a reason
    Given an email address that already belongs to an organization member
    When that address is invited again
    Then the invite is refused with the already-a-member code
    And the refusal names the address

  @unit
  Scenario: Inviting a new address still succeeds
    Given an email address that belongs to nobody in the organization
    When that address is invited
    Then the invite is created

  # ---------------------------------------------------------------------------
  # A missing workflow is a missing workflow
  #
  # Observed: a bare "404 / An error occurred" on a blank page, with no
  # navigation and no way back, while the console held "Workflow not found".
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A workflow that does not exist explains itself in the app shell
    Given a studio URL for a workflow that does not exist
    When the page settles
    Then the workflow is reported as not found
    And the surrounding navigation is still available

  @integration
  Scenario: A workflow that fails to load explains itself in the app shell
    Given a studio URL whose workflow load fails
    When the page settles
    Then the failure is explained in place
    And the surrounding navigation is still available

  # ---------------------------------------------------------------------------
  # A rejected form says why, where the user is looking
  #
  # Observed: signing up with mismatched passwords drew a red outline around
  # Confirm Password and put no words anywhere on the page. The sentence was
  # computed and dropped — every control passed `invalid` and none passed the
  # message — so all four fields were mute, not just this one.
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Mismatched passwords say so
    Given a sign-up form
    When the confirmation does not match the password
    Then the confirmation field explains that the passwords must match
    And the account is not created

  @integration
  Scenario: A missing name says so
    Given a sign-up form
    When the name is left empty
    Then the name field explains that it is required

  # ---------------------------------------------------------------------------
  # The gateway's own failures
  #
  # The virtual-key and budget surfaces landed after this migration was written,
  # so they had no channel and invented one: a pseudo-code on the front of a
  # prose message ("scope_org_mismatch: team tm_… is not in organization org_…",
  # "missing_perm:gatewayGuardrails:attach"). That shipped internal record ids
  # to whoever asked, named our storage engines in customer copy, and still left
  # the client with no code to key copy off.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A cross-organization scope is refused without naming the record
    Given a request naming a team outside the caller's organization
    When the scope is validated
    Then the refusal carries the gateway scope mismatch code
    And it names the kind of scope but not its id

  @unit
  Scenario: A virtual key the caller cannot see is indistinguishable from a missing one
    Given a virtual key that exists but is not visible to the caller
    When it is requested
    Then the answer is the same not-found code a genuinely missing key gives

  @unit
  Scenario: A limit of the deployment is not blamed on the customer
    Given a deployment that cannot track spend per member
    When a per-member budget is requested
    Then the refusal is attributed to the platform
    And the copy does not name the storage engine

  # ---------------------------------------------------------------------------
  # Member and team governance refusals
  #
  # Each of these was raised as a bare ValidationError: a real sentence in the
  # `message`, and nothing in `meta`. Since the wire message became the code
  # slug, the presentation registry had only `validation_error` to go on, which
  # reads its copy off `meta.fieldErrors` / `meta.formErrors` and so fell all
  # the way through to "Some of the values aren't valid." The server knew which
  # team and which admin; the customer was told to check their input.
  #
  # A refusal about who administers a team names the team, because "this team"
  # is not a thing the reader can act on when they are looking at a member who
  # belongs to several.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Refusing to leave a team without an admin names the team
    Given a member is the only admin of a shared team
    When a change would leave that team with no admin
    Then the refusal carries the last-team-admin code
    And the copy names the team and says to promote another admin first

  @unit
  Scenario: Being the last admin oneself is a different sentence
    Given an admin is the only admin of their own team
    When they try to demote themselves there
    Then the copy tells them somebody else has to hold the role first
    And it does not read as though a colleague could fix it for them

  @unit
  Scenario: A Lite Member seat that only allows Viewer says so as itself
    Given a member on a Lite Member seat
    When a team role other than Viewer is requested for them
    Then the refusal carries the lite-member-viewer-only code
    And the copy explains that the seat decides the team role

  @unit
  Scenario: None of these refusals reach the customer as check-your-input
    Given the member and team governance refusals
    When each is presented
    Then none of them falls through to the generic validation copy

  # ---------------------------------------------------------------------------
  # The SDK error mappers
  #
  # A refusal the platform wrote prose for reaches the caller as that prose, in
  # every SDK. The Python mapper read the top-level envelope only and rendered
  # a word derived from the status, so a plan gate served as a 403 arrived as
  # "authentication failed" and nothing else: the operator was sent to rotate
  # credentials that were never the problem, while the sentence explaining the
  # plan sat unread in the body.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A refusal the platform explained keeps its explanation in the SDK
    Given the platform refuses a gateway read and writes why
    When the SDK raises for that response
    Then the raised error carries the platform's sentence
    And it does not report the credential as the problem

  @unit
  Scenario: The platform's sentence is read from either envelope spelling
    Given the same refusal nested under an error field
    When the SDK raises for that response
    Then the raised error carries the same sentence

  @unit
  Scenario: A refused credential still reads as an authentication failure
    Given the platform rejects the credential itself
    When the SDK raises for that response
    Then the raised error says authentication failed
