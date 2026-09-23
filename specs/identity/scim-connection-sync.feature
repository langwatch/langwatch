Feature: Directory sync per connection - one token, one connection, and a deprovision that proves itself
  As an enterprise wiring its identity provider to LangWatch
  I need each directory token to reach exactly the connection it was issued
  for, and a removal to leave nothing behind
  So that a directory push can never touch another organization, and
  offboarding a leaver is a fact somebody can check rather than a hope

  # D08 (delivery plan Wave 3). The SCIM protocol surface does not change -
  # this is about what a token may reach, whose identity a push is about, and
  # what a removal has to prove. Group mapping keeps its own file
  # (specs/features/scim-group-mapping.feature); the mint and revoke contract
  # keeps its own (specs/organizations/scim-tokens-rest-api.feature).
  #
  # SCIM becomes a COMMAND PRODUCER. The endpoints answer the same protocol
  # to the same identity providers, but behind them a push no longer writes
  # rows: it issues commands into the identity pipeline, each landing an
  # event, and every membership consequence goes through the grants service -
  # the one that runs the offboard proof - rather than straight at the
  # ledger. That is the whole deliverable in one line, and it is what makes
  # a removal checkable, a failure visible, and a replay free.
  #
  #   [*] ──token minted for a connection──► TOKEN_ISSUED
  #        TOKEN_ISSUED ──first push──────► SYNCING
  #        SYNCING ⇄ ERROR                 (apply failed / retried with backoff)
  #        SYNCING ──revoked or torn down─► REVOKED
  #        ERROR   ──revoked or torn down─► REVOKED
  #
  # Two facts about one person, kept apart on purpose:
  #
  #   WHO the directory means      the connection plus the directory's own
  #                                identifier for them - a pair. The address
  #                                is not identity: people change theirs, and
  #                                the same person carries different
  #                                identifiers on two different connections.
  #
  #   WHO made the write           one directory principal, globally. The
  #                                actor stamped on a membership fact is NOT
  #                                the connection: system principals are a
  #                                closed, named set that no call site may
  #                                invent a member of, and a connection id is
  #                                a per-customer value. Which connection
  #                                pushed a change is recorded on the sync's
  #                                own history, where it belongs. Nothing is
  #                                lost by this: cross-organization safety
  #                                comes from what the TOKEN may reach, not
  #                                from what the actor stamp says.
  #
  # Membership consequences are grants, never rows written by hand, and they
  # are stamped as directory-sourced so a customer's audit page shows them.
  # Nothing a push does may leave a membership behind that no event explains.
  #
  # CALIBRATION on the deprovisioning scenarios below. Today a deprovision
  # marks the person deactivated and leaves their grants in place, and
  # deactivation does block sign-in and API-key verification - so what is
  # being fixed here is LATENT retained authority, not an open door. It
  # matters because latent authority comes back without a decision: today
  # reactivating somebody silently restores every permission they held on
  # the day they left. The scenarios below are written against that risk,
  # not against a live breach.
  #
  # Ships behind SCIM_V2_GRANTS; the previous write path returns with the flag.

  Background:
    Given an organization "acme" on the Enterprise plan, administered by "ana"
    And "acme" has an ACTIVE SSO connection "okta-primary" and a second one "entra-contractors"
    And directory sync is enabled for "acme"

  # ── A token reaches one connection ─────────────────────────────────────

  # Needs Postgres: a stored token row read back through verifyEntitled,
  # and a push authenticated with it landing a sync fact that names the
  # connection. Attribution cannot be observed without a real push.
  @integration
  Scenario: A token is issued against exactly one connection
    When a directory token is minted for "okta-primary"
    Then the token names "okta-primary" as the connection it was issued for
    And pushes authenticated with it are attributed to that connection

  @unit
  Scenario: A token cannot exist without a connection to belong to
    When a directory token is minted without naming a connection
    Then the request is refused with code scim_connection_required and status 422

  @unit
  Scenario: A token cannot be issued against another organization's connection
    Given a connection belonging to a different organization
    When a directory token is minted for it
    Then the request is refused with code scim_connection_not_found and status 404
    And nothing about the other organization is revealed

  # Needs Postgres: a ScimExternalId row held by the other connection, and
  # the person's rows read back UNCHANGED after the refusal. A mock proves
  # no write was attempted, which is a weaker claim than nothing moved.
  @integration @unimplemented
  Scenario: One connection's token cannot touch another connection's people
    Given a person provisioned through "entra-contractors"
    When a push authenticated with "okta-primary"'s token tries to change them
    Then the push is refused with code scim_write_outside_connection and status 403
    And that person is unchanged

  @unit @regression
  Scenario: Group membership writes respect directory ownership
    Given a group belongs to one directory and a member belongs to a sibling directory
    When the first directory adds or removes that member through POST PUT PATCH or DELETE
    Then the write is refused with scim_write_outside_connection
    And no membership is changed by the refused operation

  # Proven at the service layer, with Prisma mocked
  # (ee/scim/__tests__/scim-token.service.unit.test.ts): the delete is scoped
  # to this connection's own tokens and the sync lifecycle folds to REVOKED
  # with cause "teardown". The refused push and the untouched sibling
  # connection follow from that same scoped call.
  @unit
  Scenario: Tearing a connection down ends its tokens
    Given "okta-primary" has a working directory token
    When "okta-primary" is torn down
    Then its sync is REVOKED
    And a push authenticated with that token is refused
    And "entra-contractors" keeps syncing untouched

  # ── Who the directory means ────────────────────────────────────────────

  @unit
  Scenario: A blank external identifier is read as none rather than refused
    Given a provisioning client that has no external identifier for a person
    And it sends the field anyway, empty
    When it pushes that person
    Then the person is accepted with no external identifier
    And the push is not refused over a field nothing required

  @integration @regression
  Scenario: A directory manages a person even when externalId is absent
    Given a directory pushes a person with no externalId or a blank externalId
    When the person is created and then updated by that connection
    Then the directory manages that person exactly once
    And the organization shows that directory as their source
    And no invented external identifier is stored
    And another organization cannot read that ownership

  @integration @regression
  Scenario: Omitting externalId does not let another connection change the person
    Given a directory created a person without an externalId
    When another connection tries to deactivate them
    Then the push is refused with code scim_write_outside_connection
    And the stored user is unchanged

  @integration @regression
  Scenario: A directory can reactivate its person without an externalId
    Given a directory created a person without an externalId
    And the person was deactivated and their membership removed
    When the same connection pushes the person active again
    Then they can sign in again
    But their old membership and role bindings are not restored

  @integration @regression
  Scenario: Deleting a directory person forgets ownership without reclaiming it
    Given a person is known by two connections
    When one connection deletes them
    Then that connection's ownership and external identifiers are removed
    And the other connection's identifiers and ownership remain
    And the deleting connection cannot reactivate the person it forgot

  @integration @regression
  Scenario: Creating an inactive directory person grants no access
    Given a directory creates a person with active false and a cost center
    When the same inactive creation is submitted again
    Then one inactive directory resource exists and the directory owns it
    And its shared account is not globally disabled
    And no organization membership, role binding or department assignment exists

  @integration @regression
  Scenario: Repeating an inactive creation does not restore a departed person's access
    Given a directory deactivated a person and their membership was removed
    When it submits that person for creation with active false again
    Then the same directory resource remains inactive
    And no membership, role binding or department assignment is restored

  @integration @regression
  Scenario: Inactive provisioning cannot deactivate an unowned account in another organization
    Given an active account belongs to another organization
    And this directory does not own that account
    When the directory tries to create that email with active false
    Then an inactive resource is recorded in the requesting organization
    And the existing account and its membership are unchanged
    And the requesting directory owns only its tenant resource and grants no access

  @integration @regression
  Scenario: Retained directory ownership cannot deactivate an account that has left the organization
    Given a directory-owned person no longer belongs to that organization
    And their active account administers another organization with a live session
    When the old directory submits their account for creation with active false
    Then its directory resource is marked inactive
    And the active account, other organization's membership and session are unchanged

  @integration @regression
  Scenario: An inactive directory resource can be deleted without a membership
    Given a directory created an inactive person without organization access
    When it deletes that resource
    Then its ownership and external identifiers are removed
    And another deletion or reactivation is refused with status 404

  @integration @regression
  Scenario: Deleting a former directory resource preserves access in other organizations
    Given a directory-owned person no longer belongs to that organization
    And their active account belongs to another directory and organization with a live session
    When the old directory deletes its resource
    Then only the old directory's ownership and external identifiers are removed
    And the active account, other organization's membership and session are unchanged

  @unit
  Scenario: A person keeps their place when their address changes
    Given a person provisioned through "okta-primary"
    When the directory pushes them again with a new email address and the same directory identifier
    Then the same LangWatch account is updated
    And no second account is created

  @unit
  Scenario: The same person on two connections is two directory identities, one account
    Given a person is provisioned through "okta-primary"
    When "entra-contractors" pushes the same person under its own directory identifier
    Then both directory identities resolve to the one LangWatch account
    And neither connection's identifier overwrites the other's

  @unit
  Scenario: The same directory identifier on two connections is two different people
    Given "okta-primary" and "entra-contractors" both push the directory identifier "u-1"
    When both pushes are applied
    Then each resolves within its own connection
    And neither push resolves to the other's person

  @unit
  Scenario: A push naming a person no connection knows provisions within that connection only
    When "okta-primary" pushes an unknown directory identifier
    Then the person is created and recorded under "okta-primary"
    And "entra-contractors" still does not know them

  # ── A push is a command, and membership is a grant ─────────────────────

  # Needs Postgres and the HTTP boundary: a full push, group and deactivate
  # cycle replayed against the real routes, compared response by response.
  @integration @unimplemented
  Scenario: The protocol is unchanged and the writes underneath are not
    Given an identity provider configured against "acme" before the flip
    When it runs its usual push, group and deactivate cycle unchanged
    Then every request is answered exactly as it was before
    And nothing in its configuration had to change

  # Needs Postgres and the event store: the appended event read back, and the
  # grant row carrying it as its cause. Nothing reads that causation link
  # yet - building the read is what unblocks this.
  @integration @unimplemented
  Scenario: A push asserts membership through a command, not by writing a row
    When "okta-primary" pushes a new person into "acme"
    Then the push issued a command and the command landed an event
    And their membership arrives as a grant carrying that event as its cause
    And the grant is stamped as directory-sourced
    And no membership row was written outside that path

  @unit
  Scenario: Membership is no longer a fixed role written beside the grant
    When "okta-primary" pushes a new person into "acme"
    Then the role they hold is the one the directory's mapping asserts
    And no membership is created with a role nothing asserted

  # Older pushes minted an organization-scoped grant per person. With the flag
  # on, a group's grant is what carries that access, so the direct one is a
  # duplicate that outlives the group it was meant to stand in for.

  @unit
  Scenario: Group access replaces the membership grant an older push minted
    Given the directory grants flag is on
    When "okta-primary" pushes somebody who already holds a directory-written membership grant
    Then that organization-scoped grant is retired as the directory
    And no membership grant is written in its place

  @unit
  Scenario: Taking somebody out of a group retires the membership grant they kept
    Given the directory grants flag is on
    When "okta-primary" takes somebody out of a group, or deletes the group they were in
    Then the membership grant the directory wrote for them at the organization is retired
    And it is retired before their group membership goes
    And a grant an administrator made for them by hand at the same scope stays

  @unit @unimplemented
  @unit
  Scenario: Every membership a directory push causes is explained by an event
    Given "acme" has been synced through a full push, group and removal cycle
    When "acme"'s memberships are read back against the events that caused them
    Then every one of them names the event that caused it
    And none of them is a row nothing in the history accounts for

  @unit
  Scenario: The fact records which connection pushed it, and one directory actor
    When "okta-primary" pushes a membership change
    Then the sync's history names "okta-primary" as the connection that pushed it
    And the membership fact's actor is the one directory principal, the same on every connection
    And no per-customer value is used as an actor

  @unit
  Scenario: Directory-sourced membership changes stay on the customer's audit page
    When "okta-primary" pushes people in and out of "acme"
    Then each change appears on "acme"'s audit page
    And it is told apart from a change an administrator made by hand

  # Needs Postgres: the grant row's actor column after a settings-page write,
  # and the group's scimSource still refusing hand edits.
  @integration @unimplemented
  Scenario: An administrator mapping a directory group is attributed to the administrator
    Given a directory group "engineering" received from "okta-primary"
    When "ana" gives that group a role at a scope from the settings page
    Then the mapping arrives as a grant with "ana" as the actor, not the directory
    And the access it gives the group's members resolves the ordinary way
    And the group keeps its directory provenance, so it stays uneditable by hand

  # ── Removal, and what it has to prove ──────────────────────────────────

  # A removal is the highest-stakes thing a directory does, because the
  # customer's reason for doing it is usually that somebody left under a
  # cloud. "We deleted some rows" is not an answer. The postcondition is.

  @integration
  Scenario: Deprovisioning leaves no effective permission anywhere
    Given a person in "acme" holding organization membership, group memberships and direct role bindings
    When "okta-primary" deprovisions them
    Then the removal is proved to have left nothing that resolves for them in "acme"
    And a permission check for them in "acme" answers no, everywhere

  # Deactivation used to be the quiet case: it set a flag that stopped
  # sign-in and left every grant in place. Nobody could use those grants
  # while deactivated, so it read as harmless - but it meant reactivating
  # somebody handed back everything they held on the day they left, with
  # nobody deciding that. So deactivation is a deprovision like any other,
  # and coming back is re-entry rather than undo.

  @integration
  Scenario: Marking somebody inactive is a deprovision, not a flag
    Given a person in "acme" with access through a group and a direct role binding
    When "okta-primary" pushes them as inactive
    Then their access is removed with the same proof a deletion carries
    And their next permission check in "acme" answers no
    And no grant of theirs in "acme" is left standing behind the flag

  # The rollback lever exists so a deployment can go back to the previous way
  # of writing membership, and WHO writes it is the whole of what it chooses.
  # Whether a leaver keeps their access is not a thing it gets a vote on - but
  # it had one, because that branch was written for a deletion and never for a
  # deactivation. So on the shipped default a directory pushing somebody
  # inactive stopped their sign-in and left their role grant, their membership
  # and their seat where they were, and the change list, which reads revoked
  # grants, recorded nothing at all. A deletion was never like that, on either
  # setting, which is what makes this an omission rather than a policy.

  @unit
  Scenario: A leaver loses their access however membership is being written
    Given a deployment still writing membership the previous way
    When the directory pushes somebody inactive
    Then their grants are revoked and the revocation is recorded
    And they stay a member holding nothing, rather than being deleted

  # Needs Postgres: the collector answering nothing for them after a
  # reactivating push. `reinstateSignIn` covers the sign-in half at unit
  # level; the holds-nothing half is a real permission collection.
  @integration @unimplemented
  Scenario: Coming back restores nothing on its own
    Given somebody in "acme" was pushed inactive and their access was removed
    When "okta-primary" pushes them active again
    Then they can sign in
    And they hold no access in "acme" until the directory asserts it again
    And what they held before their removal is not restored by the reactivation

  # Needs Postgres: the grants attached by the next push, and the ones an
  # administrator gave by hand still absent.
  @integration @unimplemented
  Scenario: The next full push is what puts a returning person back
    Given somebody in "acme" was pushed active again and holds no access
    When "okta-primary" runs its next full push with them in it
    Then the access that push asserts is attached, and nothing else is
    And access an administrator had given them by hand before they left stays gone
      until an administrator gives it again

  # ── The organization's own way in is not the directory's to close ──────
  #
  # A full sync asserts the set it knows about and deactivates the rest, and
  # the administrator somebody invited by hand is in nobody's directory. On a
  # real stack the first sync reported "1 created and 4 deactivated" and one
  # of the four was the organization's only administrator: their session died
  # mid-page, their password was then refused, and no screen undoes it.
  #
  # What is refused is narrower than adoption, and is about the organization
  # rather than the person: the one act that leaves nobody able to administer
  # it. It is the refusal `setMemberDisabled` already makes by hand.

  @unit
  Scenario: A directory cannot deactivate the last administrator who can still sign in
    Given "acme" whose only administrator was invited by hand
    When the directory pushes that administrator as inactive
    Then the push is refused
    And the administrator is left exactly as they were

  @unit
  Scenario: A directory may deactivate an administrator while another can still get in
    Given "acme" with a second administrator who can sign in
    When the directory pushes the first administrator as inactive
    Then the deprovision goes through

  @unit
  Scenario: An administrator who is already deactivated does not count as a way in
    Given "acme" whose other administrators have all been deactivated
    When the directory pushes the remaining administrator as inactive
    Then the push is refused
    # Counting memberships alone would let one sync deactivate two
    # administrators in turn, each passing because the other's membership had
    # not been marked yet.

  @unit
  Scenario: A removal that cannot prove itself empty fails loudly
    Given a removal whose proof still finds something resolving for the person
    When the removal is applied
    Then it is refused with code offboard_incomplete and status 500
    And nothing about that person's access has changed
    And the failure names what was still resolving
    And it is surfaced as a dead letter rather than being retried into silence

  @unit
  Scenario: The proof runs on every path a directory can remove somebody by
    Given a person in "acme" holding access
    When they are removed by deletion, and when they are removed by being pushed inactive
    Then both removals ran the proof
    And neither could complete while anything still resolved for them

  # That a removal denies before the push returns, queue or no queue, is
  # specs/features/scim-group-mapping.feature's and is unchanged by D08.

  @unit
  Scenario: A removal decision needing a person is surfaced, not guessed at
    Given the person being removed owns credentials or a personal team
    When the removal is applied
    Then their access in "acme" is still removed and proved empty
    And what needs a human decision is named for an administrator to act on

  # ── When a push fails ──────────────────────────────────────────────────

  @unit
  Scenario: A failed apply moves the sync into ERROR where somebody can see it
    When an apply fails for "okta-primary"
    Then the sync for "okta-primary" is ERROR
    And the failure is visible with the connection, the operation and a reason code
    And "entra-contractors" is unaffected

  @unit
  Scenario: A retryable failure backs off and recovers on its own
    Given "okta-primary" is in ERROR after a retryable failure
    When the retry succeeds
    Then the sync is SYNCING again
    And the recovery is visible in the same place the failure was

  @unit
  Scenario: A failure that will never succeed is retired visibly, never silently
    Given an apply for "okta-primary" that cannot succeed however often it runs
    When it stops being retried
    Then it is retired as a visible dead letter naming what could not be applied
    And it is never dropped, and the directory's state is never assumed applied

  @unit
  Scenario: A deactivate that cannot be applied is as visible as any other failure
    Given "okta-primary" pushes somebody inactive and the removal cannot be applied
    When it stops being retried
    Then it is retired as a visible dead letter naming that person and the removal
    And they are not left marked inactive while still holding access
    And the state the directory asked for is never reported as reached

  @unit
  Scenario: The failure surface says nothing a customer should not read
    When any directory failure is shown
    Then it names the connection, the operation and a reason code
    And it carries no token, no secret and no internal hostname

  # ── The flag ───────────────────────────────────────────────────────────

  @unit
  Scenario: With the flag off the previous write path answers exactly as before
    Given the directory grants flag is off
    When "okta-primary" pushes people into "acme"
    Then membership lands the way it did before the flip
    And the tokens keep working throughout

  # The flag chooses HOW access is removed. Whether an organization may be
  # left with nobody able to administer it is not the flag's to answer, and
  # the previous write path deletes the membership row itself.

  @unit
  Scenario: The refusal does not depend on the directory grants flag
    Given the directory grants flag is off
    And "acme" whose only administrator was invited by hand
    When the directory pushes that administrator as inactive, or deletes them
    Then the push is refused before the membership row or their grants go
    And the refusal is the organization's own, not a second copy of the rule

  # ── The tenant's own directory resource ────────────────────────────────
  #
  # A person's SCIM userName, display name and active flag belong to the
  # organization whose directory pushed them, not to the account they sign in
  # with: one account in two organizations carries two resources, and neither
  # directory can rename, disable or delete the account itself.

  @unit @regression
  # ── What a push does about the person on the other end ─────────────────
  #
  # The arrival matrix: every combination of "do they already have an
  # account here" and "are they already a member", plus what a removal
  # leaves behind and what a re-push does. The directory has already made
  # the access decision, so a push does not ask the joining policy that a
  # self-serve arrival would - which is exactly why the matrix is written
  # down rather than left to be inferred.
  #
  # OPEN, and deliberately not stated as behaviour below: adoption today
  # matches on the User.email column alone, so it will adopt an account
  # holding an address nobody ever proved. The scenario says "adopts rather
  # than duplicates", which is right in every case; whether the account must
  # have PROVED the address first is the open question, and the answer
  # narrows the match rather than changing the shape.

  @integration
  Scenario: A directory push provisions whatever the sign-in door would do
    Given "okta-primary" pushes somebody who has no account here
    Then the account is created and the membership lands
    And the joining policy is not consulted, because the administrator already decided

  @integration
  Scenario: A directory adopts a member who already had an account
    Given somebody already has an account but no membership in "acme"
    When "okta-primary" pushes them
    Then their existing account gains the membership
    And no second account is created for the same address

  @integration
  Scenario: A directory push that changes nothing changes nothing
    Given somebody the directory has already pushed into "acme"
    When the same push arrives again
    Then it is refused with status 409
    And they still hold exactly one membership

  @integration
  Scenario: A directory push follows the person, not the address
    Given somebody provisioned through "okta-primary"
    When the directory pushes them again under a changed address
    Then the directory's own identifier is what resolves them
    And no account is created for the new address

  @integration
  Scenario: A removed person the directory pushes again comes back
    Given somebody the directory removed from "acme"
    When the directory pushes them again
    Then the membership is restored
    And they still hold exactly one account

  @integration
  Scenario: A removal leaves nothing behind in the organization
    Given somebody the directory removed from "acme"
    Then they hold no membership and no role binding there
    And their account itself survives, because it is theirs and not the organization's

  # ── The organization's own way in is not the directory's to close ──────
  #
  # A directory that adopts unclaimed members (above) necessarily reaches the
  # administrator somebody invited by hand, because that person is in nobody's
  # directory. A full sync asserts the set it knows about and deactivates the
  # rest — so on a real stack the first sync reported "1 created and 4
  # deactivated" and one of the four was the organization's only
  # administrator. Their live session died mid-page and their password was
  # then refused, and there is no screen in the product that undoes it.
  #
  # Adoption stays. What is refused is narrower, and is about the organization
  # rather than the person: the one act that leaves nobody able to administer
  # it. It is the refusal `setMemberDisabled` already makes by hand.

  @unit
  Scenario: Issuing a new token brings a revoked connection back
    Given a connection whose token was revoked
    When an administrator issues another one
    Then the connection reports itself as waiting for the directory again
    # Revoke and issue another is the advice the token screen itself gives.
    # While a revocation absorbed everything, taking that advice left the
    # connection reading "sync has ended" for good while provisioning worked
    # underneath it, and only a platform operator could move it.

  @unit
  Scenario: A push that arrives after a revocation still does not revive it
    Given a connection whose token was revoked
    When a straggling push arrives on the old token
    Then the connection stays revoked

  # A name reaches us as two halves and is stored as one string, so a directory
  # that patches one half is asking us to change that half and leave the other.
  # Okta and Entra both patch one part at a time, over a dotted path carrying a
  # plain string — the one spelling the handler used to skip entirely, answering
  # 200 with the record untouched and filing it in the request log as accepted.

  @unit
  Scenario: A directory patches one half of a name with a dotted path
    Given a person the directory provisioned as "Ada Lovelace"
    When the directory patches only their surname to "Smith"
    Then they are stored as "Ada Smith"
    And the change is reported as applied rather than merely accepted

  @unit
  Scenario: A directory replaces both halves of a name at once
    Given a person the directory provisioned as "Ada Lovelace"
    When the directory sends both halves of a new name
    Then they are stored as exactly the name that was sent

  @unit @regression
  Scenario: Directory ownership is isolated by organization and follows connection retirement
    Given two organizations provision the same user through different connections
    Then each directory can update its own organization
    And a sibling directory in the same organization is refused
    When the owning connection is torn down or replaced at finalization
    Then its ownership no longer prevents the authorized successor from provisioning
    And a token without a connection retains organization-wide authority

  @unit @regression
  Scenario: Rotating a token keeps the surviving connection sync live
    Given a connection has a working token A and a newly minted token B
    When token A is revoked and token B pushes a user
    Then the sync records the push and is not revoked
    When its last token is revoked
    Then the sync is revoked

  @integration @regression
  Scenario: Legacy SCIM tokens retain organization-wide group reads
    Given an organization has legacy and connection-owned groups
    When a token without a connection reads or matches a group by name
    Then it sees every group in its organization
    And groups in another organization remain absent

  @integration @regression
  Scenario: Concrete SCIM tokens keep sibling groups outside their reads
    Given two directories own groups in the same organization
    When one directory reads groups or provisions a sibling's group name
    Then it sees only its own groups and legacy groups
    And it can provision its own group with the sibling's name

  @integration @regression
  Scenario: Group external identifiers belong to their directory namespace
    Given two directories and a legacy token provision groups in one organization
    Then each can use the same external identifier for its own group
    And a duplicate identifier within one directory or the legacy namespace is refused
    And another organization's legacy namespace remains independent

  @integration @regression
  Scenario: Directory lifecycle and profile changes affect only their organization
    Given a person belongs to two organizations and has an active session
    When one directory changes their profile or deactivates them
    Then only that organization's directory profile and access change
    And the shared account identity and sessions remain unchanged
    When that directory reactivates them
    Then no membership or grants are restored
    And a global account disable is not cleared

  @unit @regression
  @integration @regression
  Scenario: Inactive directory resources remain readable without granting access
    When a directory provisions a person as inactive
    Then GET and filtered paginated listings return the inactive resource
    And no organization membership is granted
    When the directory updates the inactive profile or cost center
    Then no organization membership is granted
    When the directory deletes the resource
    Then GET no longer returns it
    And listings and updates no longer reach it
    And an inactive tenant tombstone continues blocking SSO
    When the directory explicitly provisions the primary account again
    Then the tombstone is cleared without creating a second account

  @unit @regression
  @integration @regression
  Scenario: An inactive directory user cannot sign in through its connection
    Given a directory resource is inactive in an organization
    When its identity provider asserts the same account through that organization's connection
    Then sign-in is refused before provisioning membership or creating a session
    And another organization's directory state does not block this connection

  @integration @regression
  Scenario: Existing directory ownership backfills tenant resources without reactivating shared accounts
    Given a directory owns a globally disabled account and two organizations share another account
    When the tenant resource migration runs
    Then every distinct organization and user pair has one directory resource
    And historical global disables and primary email addresses remain unchanged

  @unit @regression
  Scenario: Missing organization scope never widens a SCIM query
    When a user or group operation receives a missing or blank organization
    Then the scope is refused before any database query

  @integration @regression
  Scenario: Directory usernames stay unique without mutating a conflicting resource
    Given two users have directory resources in one organization
    When PUT or PATCH would assign the other user's normalized username
    Then the request returns a uniqueness conflict before changing profile or access
    And a manually added member's fallback username is protected before directory adoption
    And the database refuses duplicate live names independently
    When the original resource is deleted
    Then its username can be assigned to another resource
