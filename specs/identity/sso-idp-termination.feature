Feature: Terminating an organization's identity provider - OpenID Connect and SAML
  As the administrator of a company whose staff sign in through its own
  identity provider
  I need the connection I registered to actually carry a sign-in
  So that setting single sign-on up in LangWatch ends with somebody signing
  in, rather than with a support ticket asking us to redeploy

  # D09 (ADR-117 §5's named debt, closed). D04 built the connection
  # lifecycle and D05 built the surfaces that drive it; neither could make a
  # sign-in ARRIVE anywhere. A deployment mounted exactly one identity
  # provider from environment variables, and a connection an organization
  # registered itself named a provider the deployment had never heard of, so
  # the router refused it with `method_not_configured` forever. That is the
  # gap this deliverable closes.
  #
  # THE ENGINE. better-auth's single sign-on plugin terminates both
  # protocols. It is registered alongside the plugins already mounted, it
  # owns one table of its own (`SsoProvider`), and it is the only thing in
  # the product that speaks OpenID Connect discovery or reads a SAML
  # assertion. Nothing here re-implements either protocol.
  #
  # THE DIVISION OF LABOUR, which is the whole design:
  #
  #   the aggregate    decides WHETHER a connection may route: who claimed
  #                    the domain, who approved it, what proved it, and what
  #                    state the connection is in. It holds no credential -
  #                    `clientIdRef`, `secretRef` and `certRefs` are
  #                    references and always were (ADR-101 §4).
  #   the vault        holds the credential values, encrypted at rest under
  #                    the same key every other credential in the product
  #                    uses. It is what the references point AT. Until D09 it
  #                    did not exist and every reference was written null.
  #   the engine       holds the dialing configuration and does the talking.
  #                    One row per registered connection, keyed by the
  #                    connection's own id so two organizations naming their
  #                    provider `okta` can never collide.
  #
  # SAML IS NO LONGER REFUSED BY NAME. D05 refused it on both surfaces
  # because nothing could terminate it. Something can now, so both refusals
  # are deleted rather than moved, and `sso_saml_not_self_serve` is retired
  # with them.
  #
  # WHAT THE CUSTOMER SEES FIRST. An administrator cannot configure their
  # identity provider from a form that only asks them questions: their side
  # needs OUR side - where to send the assertion, what to call us, which
  # address to redirect to. So the setup surface presents LangWatch's service
  # provider details BEFORE it asks for a single field, on both protocols.
  #
  # ROLLOUT IS THE CONNECTION ITSELF, and NOT the `SSOCONN_ROUTING`
  # environment variable D04 shipped, nor the per-organization feature flag
  # D09 replaced it with. An environment variable is a fleet-wide decision
  # and this is a per-customer one; a feature flag had the grain right and
  # the control wrong. An administrator who proves a domain, tests a
  # sign-in, holds a way back in and turns the connection on has said what
  # they want, and a second switch they cannot reach only meant their
  # connection read "on" while it carried nobody. Turning it on IS the
  # decision, and turning it off is how a customer rolls back.

  Background:
    Given an organization on an Enterprise plan whose administrator holds
    "sso:manage"
    And the organization is allowed to set single sign-on up itself

  # ---------------------------------------------------------------------
  # Registering - OpenID Connect
  # ---------------------------------------------------------------------

  @unit
  Scenario: Registering an OpenID Connect provider takes the credentials it will dial with
    When the administrator registers an OpenID Connect provider with an
    issuer address, a client id and a client secret
    Then the connection is registered
    And the client id and the client secret are stored in the credential
    vault
    And the connection's metadata carries a reference to each of them rather
    than either value
    And the engine holds a provider for this connection

  @unit
  Scenario: A client secret never reaches the event log
    When the administrator registers an OpenID Connect provider with a client
    secret
    Then no fact the registration wrote contains the secret
    And no fact the registration wrote contains the client id

  @unit
  Scenario: An OpenID Connect registration without a client id is refused before anything is written
    When the administrator registers an OpenID Connect provider and names no
    client id
    Then the registration is refused with "sso_credentials_required"
    And no connection is registered
    And the credential vault holds nothing for the organization

  @unit
  Scenario: An issuer that cannot be reached is refused in the customer's words
    Given the issuer address the administrator gave publishes no discovery
    document
    When the administrator registers an OpenID Connect provider with it
    Then the registration is refused with "sso_issuer_unreachable"
    And no connection is registered

  # ---------------------------------------------------------------------
  # Registering - SAML
  # ---------------------------------------------------------------------

  @unit
  Scenario: A SAML provider is registered from the identity provider's metadata
    When the administrator registers a SAML provider by pasting their
    identity provider's metadata
    Then the connection is registered with type "saml"
    And the engine holds a provider for this connection
    And the metadata is stored in the credential vault
    And the connection's metadata carries a reference to it

  @unit
  Scenario: A SAML provider is registered from an entity id and a certificate
    When the administrator registers a SAML provider with a sign-in address,
    an entity id and a signing certificate
    Then the connection is registered with type "saml"
    And the certificate is stored in the credential vault
    And the connection's metadata carries a certificate reference

  @unit
  Scenario: SAML is no longer refused for being SAML
    When the administrator registers a SAML provider
    Then the refusal "sso_saml_not_self_serve" is not raised
    And no surface in the product raises it any more

  @unit
  Scenario: Metadata that is not a SAML descriptor is refused by name
    When the administrator registers a SAML provider and pastes something
    that is not identity provider metadata
    Then the registration is refused with "sso_saml_metadata_invalid"
    And no connection is registered

  @unit
  Scenario: A certificate that cannot be read is refused by name
    When the administrator registers a SAML provider with a signing
    certificate that is not a certificate
    Then the registration is refused with "sso_certificate_invalid"
    And no connection is registered

  @unit
  Scenario: A SAML registration naming neither metadata nor an entity id is refused
    When the administrator registers a SAML provider with a sign-in address
    and nothing that identifies the identity provider
    Then the registration is refused with "sso_credentials_required"

  @integration
  Scenario: A valid signing certificate authenticates an assertion
    Given a SAML connection configured with a known signing certificate
    When its identity provider sends an assertion signed by the corresponding key
    Then the assertion reaches the connection's identity policy

  @integration
  Scenario: A different or tampered signing certificate authenticates nothing
    Given a SAML connection configured with a known signing certificate
    When an assertion is signed by an unrelated key or altered after signing
    Then the assertion is refused before identity policy
    And no user, account or session is written

  @integration
  Scenario: Overlapping signing certificates in metadata both authenticate during rotation
    Given a SAML connection whose metadata contains its old and new signing certificates
    When the identity provider sends an assertion signed by either corresponding key
    Then either assertion reaches the connection's identity policy

  @unimplemented
  Scenario: A signing certificate never proves an email domain
    Given a SAML connection has a readable signing certificate and no proved domain
    When its identity provider asserts an address belonging to nobody in the organization
    Then the assertion is refused
    And no account is provisioned and no session is minted

  # Metadata is read when the administrator registers the connection. The
  # current engine does not refresh it automatically, and service-provider
  # signing-key rotation is not supported manually.

  # ---------------------------------------------------------------------
  # The vault
  # ---------------------------------------------------------------------

  @unit
  Scenario: A stored credential is unreadable without the deployment's key
    When a client secret is put in the credential vault
    Then what is written to the database is not the secret
    And reading it back through the vault answers the secret

  @unit
  Scenario: A credential belongs to the organization that stored it
    Given two organizations have each stored a client secret
    When one organization reads the other's reference
    Then nothing is answered

  # ---------------------------------------------------------------------
  # Routing
  # ---------------------------------------------------------------------

  @unit
  Scenario: A connection the engine holds a provider for counts as configured
    Given an active connection whose provider the engine holds
    When the router looks the connection's domain up
    Then the connection is configured
    And somebody signing in from that domain is redirected to the connection

  @unit
  Scenario: A connection the engine has never heard of still refuses to route
    Given an active connection the engine holds no provider for
    And this deployment mounts no matching provider of its own
    When somebody signs in from the connection's domain
    Then they are offered the local sign-in methods
    And the reason is "method_not_configured"

  @unit
  Scenario: The deployment's own mounted provider still counts as configured
    Given an active connection naming the provider this deployment mounts
    from its environment
    When the router looks the connection's domain up
    Then the connection is configured

  @unit
  Scenario: Two organizations may both call their provider okta
    Given two organizations have each registered a provider named "okta"
    When the engine is asked which provider each connection has
    Then each answer is the organization's own
    And neither registration displaced the other

  # ---------------------------------------------------------------------
  # Rollout
  # ---------------------------------------------------------------------

  @unit
  # ── What an identity provider is allowed to assert ───────────────────
  #
  # The connection is the customer's own, and so is the identity provider
  # behind it. Trusting its word on whether an address is verified is what
  # lets an organization move off a brokered provider without minting a
  # second account for everybody - and it is only defensible while the
  # address is one that connection proved it speaks for.

  @unit
  Scenario: A provider may only assert addresses on the domains it proved
    Given "acme" has a live connection that proved "acme.com"
    When its identity provider asserts an address on a domain it never proved
    Then the sign-in is refused
    And no account is linked and no session is minted

  @unit
  Scenario: A connection still being set up carries only its own people
    Given "acme" has registered a connection and proved no domain yet
    When its identity provider asserts an address belonging to nobody in "acme"
    Then the sign-in is refused
    But an administrator of "acme" signing in to test it is carried through
    And that is the sign-in going live rests on

  # NARROWED, deliberately. This rule used to read "every refusal at the door
  # says the same thing" and meant it literally, which is how seven distinct
  # causes came to share one code - and that code was the CREDENTIAL refusal,
  # so the one sentence it said was "that email or password is wrong" to people
  # who had never typed a password.
  #
  # The property worth keeping is the existence oracle, not uniformity for its
  # own sake: a refusal must not tell a caller which connection identifiers are
  # real. The refusals that report the caller's OWN assertion or their own
  # organization's configuration now name themselves, because a refusal nobody
  # can act on is not a security property, it is a dead end. Which is which is
  # specs/identity/sso-assertion-refusals.feature.

  @unit
  Scenario: A refusal about what exists here says nothing
    Given an assertion naming a connection we do not hold
    And an assertion naming something that is not a connection at all
    When each person is sent back
    Then both are refused with the same code
    And which check refused them is not something the caller learns

  @unit
  Scenario: No refusal at the door claims a password was wrong
    Given an assertion is refused for any reason
    When the person reads what they are told
    Then it does not mention a password
    # Single sign-on has its own general refusal rather than borrowing the
    # credential screen's, whose words have to keep meaning exactly one thing.

  @unit
  Scenario: A connection whose claim an operator turned down carries nobody
    Given an operator rejected "acme"'s claim on a domain
    When somebody tries to sign in through that connection
    Then the identity provider is never dialled

  @unit
  Scenario: A live connection decides the domains it proved
    Given the organization has turned its connection on
    When the sign-in router resolves a domain the connection proved
    Then the connection projection is what answered
    And the connection is counted once, not once per side

  @unit
  Scenario: A domain no connection answers for is still decided by the legacy columns
    Given an organization that never registered a connection
    When the sign-in router resolves one of its domains
    Then the legacy organization columns are what answered
    And the connection projection decided nothing

  # ---------------------------------------------------------------------
  # Coexistence with the provider this deployment already mounts
  # ---------------------------------------------------------------------

  # The two engines are not a transition. Existing enterprise customers sign
  # in through the provider `NEXTAUTH_PROVIDER` mounts, brokered SAML
  # included, and that path keeps its routes, its accounts and its behavior
  # for as long as anybody uses it. What D09 adds is a second way to arrive.

  @unit
  Scenario: A deployment mounting its own provider still routes exactly as before
    Given this deployment mounts a provider from its environment
    And an organization's grandfathered connection names that provider
    And the engine holds no per-organization provider for it
    When the router looks the connection's domain up
    Then the connection is configured
    And nothing consulted the engine's table to decide it

  @unit
  Scenario: A deployment with both resolves each connection to its own side
    Given this deployment mounts a provider from its environment
    And one organization's connection names that provider
    And another organization has registered a provider of its own
    When the router looks each connection's domain up
    Then both are configured
    And each was answered by its own side

  # A customer names their own provider, and nothing stops them naming it the
  # same thing this deployment happens to mount — `okta` is `okta`. What their
  # connection is called must therefore decide nothing: a connection the
  # organization registered is the ENGINE's to vouch for, and the engine is
  # keyed by the connection id precisely so two organizations may both say
  # `okta`. Deciding on the name let an unregistered connection inherit a
  # stranger's provider, and sent the sign-in screen at a provider id that
  # better-auth was never given.
  @unit
  Scenario: A self-serve connection naming the mounted provider is still decided by the engine
    Given this deployment mounts a provider from its environment
    And an organization registered its own connection under that same name
    When the router looks the connection's domain up
    Then the connection is configured only if the engine holds a provider for it
    And what the sign-in surface dials is the connection's own id

  # The question a customer's administrator actually asks, and the one the
  # paragraph above only PROMISED: my people sign in through our identity
  # provider today, and you have replaced the sign-in screen — does typing a
  # work address still take them there?
  #
  # Every such organization is on the legacy columns with no connection
  # registered, so that is the shape these pin: the projection answers
  # nothing, the legacy columns answer, and what comes out is a REDIRECT.
  # The scenarios above stop at which side answered and at whether the
  # connection counts as configured, neither of which is the decision the
  # person meets.
  @unit
  Scenario: An organization signing in through the mounted provider today is still sent to it
    Given this deployment mounts a provider from its environment
    And an organization whose legacy columns name that provider for its domain
    And that organization never registered a connection
    When one of its people submits their work email
    Then the decision is a redirect to that provider
    And the decision carries the reason code "domain_routed"
    And no password was ever asked for

  @unit
  Scenario: Their address routes however they happened to type it
    Given this deployment mounts a provider from its environment
    And an organization whose legacy columns name that provider for its domain
    When one of its people submits their work email in mixed case with a plus tag
    Then the decision is a redirect to that provider

  # WHAT THE LEGACY COLUMNS ACTUALLY SAY. An organization's pin is not the
  # name of a door this deployment hung. It names the identity provider its
  # people come FROM, which on a deployment that brokers sign-in is the
  # provider sitting behind the broker rather than the broker itself. Reading
  # it as a door left every brokered enterprise organization looking like one
  # naming a provider nobody here mounted, so their administrators were told
  # their single sign-on was unfinished and offered a password form.
  #
  # The broker is the door, the pin names who is behind it, and the address
  # the person typed is what tells the broker which of them to open. Who is
  # let back in is unchanged: an arrival from the wrong provider is still
  # refused against the pin.
  @unit
  Scenario: An organization pinned to a provider behind the broker is sent to the broker
    Given this deployment brokers sign-in through one provider
    And an organization whose legacy columns pin its people to an identity provider behind that broker
    When one of its people submits their work email
    Then the decision is a redirect to the broker
    And the decision carries the reason code "domain_routed"
    And no password was ever asked for

  # The failure that must NOT be a redirect. Sending somebody to a provider
  # nothing here can carry is a door that cannot open, and the local set is
  # what they can actually use.
  @unit
  Scenario: An organization naming a provider this deployment does not mount is not sent nowhere
    Given this deployment mounts a provider of its own, brokering for nobody
    And an organization whose legacy columns name a different provider
    When one of its people submits their work email
    Then the decision is the local method set
    And the decision carries the reason code "method_not_configured"

  @integration
  Scenario: Moving from the brokered provider to a direct one does not mint a second account
    Given somebody signs in today through the provider this deployment brokers
    And their address is verified on their LangWatch account
    When their organization cuts over to a connection it registered itself
    And they sign in through it for the first time
    Then the identity provider's new subject is linked to the account they
    already had
    And no second account is created for that address

  # ---------------------------------------------------------------------
  # What stops registration being an enumeration rail
  # ---------------------------------------------------------------------

  @unit
  Scenario: An organization holds one identity provider at a time
    Given the organization already has a connection
    When its administrator registers another identity provider
    Then the registration is refused with "sso_connection_already_registered"
    And the connection it already had is untouched

  @unit
  Scenario: A legacy connection may have exactly one explicit direct replacement
    Given the organization has one grandfathered identity-provider connection
    When its administrator registers the direct connection that names it as the predecessor
    Then the replacement is registered beside the legacy connection for migration
    But an ordinary second connection and any further replacement are refused with "sso_connection_already_registered"

  @integration @regression
  Scenario: Migration routing waits for the replacement to be active
    Given the replacement has completed a test sign-in but is not active
    When its administrator opens the migration
    Then switching normal sign-in to the replacement is unavailable
    And after activation the administrator can switch normal sign-in to it

  @integration @regression
  Scenario: Finalizing a migration closes its route controls
    Given a migration has started finalizing
    When its administrator opens the migration
    Then changing the sign-in route is not offered
    And finalization can be retried when its checks pass
    And after finalization no migration action is offered

  @unit @regression
  Scenario: Finishing is refused by the tenancy guard when a member's memberships are read across organizations
    Given a member of the organization also belongs to another organization
    When finishing asks whether that member's legacy identity is shared with another organization's provider
    Then the other organizations are found through the member, not by reading memberships outside the tenant
    And a membership read bounded only by "not this organization" is refused before it reaches the database

  @unimplemented
  Scenario: Finishing moves the previous connection's directory sync across
    Given the previous connection's directory sync was set up by LangWatch, so the customer never held its token
    When the update finishes
    Then the tokens the identity provider already presents belong to the new connection, and whatever pushes today keeps pushing
    And the people and external ids the previous connection provisioned are the new connection's, without duplicating anyone it provisioned itself
    And the new connection's sync history starts, and the previous connection's ends
    And before finishing, the update says the directory sync moves across when it finishes rather than asking anyone to repoint it

  @unit @integration
  Scenario: Finishing waits for directory sync on the new connection while nothing moves it across
    Given the previous connection's directory sync is pushing and the new connection has none
    When the administrator opens the update
    Then directory sync reads as needing to be set up on the new connection, and finishing is refused until it is
    And the update never says the sync moves across when it finishes

  @integration @regression
  Scenario: A person the previous connection's sync provisioned can sign in through the replacement before the update finishes
    Given the previous connection's directory sync provisioned a member who has never signed in, so their address was never verified
    And the update has switched sign-in over to the replacement
    When they sign in through the replacement
    Then they are recognised as the person the directory means, on the previous connection's word
    And the update's link policy lets them through although their address was never verified

  # Finishing never waits for members. An organization with hundreds of people
  # will not get everyone to sign in again, and does not need to: the
  # replacement recognises them by address at their next sign-in, before or
  # after the update finishes. The update lists the few it will not recognise,
  # so an administrator knows who will need a hand.

  @unit @integration
  Scenario: The new connection recognises members by address on a domain it proved, confirmed or not
    Given the update has switched sign-in over to the replacement
    And a member's address is on a domain the replacement proved, and no other account holds it
    When they sign in through the replacement
    Then they are linked to their existing account, whether or not their address was ever confirmed
    But an address on a domain the replacement has not proved, or one another account also holds, is refused

  @integration
  Scenario: Members never hold the update
    Given members have not signed in through the replacement
    When the administrator opens the update
    Then each is listed as moving across at their next sign-in, or with the reason the new connection will not recognise them
    And none of them stops the update from finishing

  @integration @regression
  Scenario: Finishing leaves a member whose only way in is the previous provider on it rather than stopping
    Given a member, active or deactivated, holds no verified way in other than the previous provider
    When the update finishes
    Then their previous identity is left in place, and stops working when the previous connection is torn down
    And every other member's previous identity is taken away
    And the update still counts access through the previous provider as retired


  @unit @integration
  Scenario: The quiet period counts from the switch-over and the last sign-in through the previous provider
    Given the update has switched sign-in over to the replacement
    When nobody signs in through the previous provider afterwards
    Then the update can finish two days after the switch-over
    But a sign-in through the previous provider after the switch-over moves that to seven days after the sign-in
    And sign-ins through the previous provider before the switch-over do not count
    And the update shows the time finishing opens

  @integration @regression
  Scenario: A revoked legacy directory sync is not one left to repoint
    Given tearing the previous connection down has revoked its directory sync
    When finishing re-reads what is outstanding
    Then directory sync is not among the conditions, since a revoked sync pushes nobody
    And finishing completes instead of asking for a repoint it has just made impossible

  @integration
  Scenario: Reading migration progress does not grant permission to change it
    Given a reader may see single sign-on but may not manage it
    When they open the migration
    Then they can read the members who have not moved across
    And no route or finalization control is offered

  @integration @regression
  Scenario: Every member still using the old provider can be reached
    Given more than twenty-five members have not moved to the replacement
    When an administrator pages through the members still using the old provider
    Then they can read the following members without repeating the first page
    And they can return to the first page

  @integration
  Scenario: A migration member page that failed can be retried
    Given the next page of members still using the old provider could not be read
    When an administrator opens that page
    Then the read failure is shown instead of an empty roster
    And they can retry the read or return to the preceding page

  @unit
  Scenario: A discarded connection is not one it still holds
    Given the organization's only connection was discarded
    When its administrator registers an identity provider
    Then the connection is registered

  # ---------------------------------------------------------------------
  # The plan gate
  # ---------------------------------------------------------------------

  @integration
  Scenario: Registering an identity provider needs an Enterprise plan
    Given the organization is not on an Enterprise plan
    When its administrator registers an identity provider
    Then the request is refused with "enterprise_plan_required"

  @integration
  Scenario: The setup screen still renders without an Enterprise plan
    Given the organization is not on an Enterprise plan
    When its administrator opens single sign-on setup
    Then the screen renders
    And it says single sign-on needs an Enterprise plan
    And no control that would be refused is offered

  # ---------------------------------------------------------------------
  # What the customer is shown
  # ---------------------------------------------------------------------

  @integration
  Scenario: LangWatch's own details are shown before the identity provider's are asked for
    When an administrator with no connection opens single sign-on setup
    Then LangWatch's addresses for the chosen protocol are shown and can be copied
    And choosing OpenID Connect shows the redirect address alone
    And choosing SAML shows the assertion address, the entity id and the
    published metadata address
    And they appear above the fields the administrator has to fill in

  @integration
  Scenario: A grandfathered connection remains active until an explicit replacement is ready
    Given an organization has a grandfathered single sign-on connection
    When its administrator opens single sign-on setup
    Then the existing single sign-on remains active
    And no generic migration action is offered

  # ---------------------------------------------------------------------
  # Taking over a single sign-on LangWatch set up
  # ---------------------------------------------------------------------
  #
  # The command that registers an organization's own identity provider beside
  # the one it signs in through today has existed since the cutover was
  # designed, and no customer screen ever called it: the only way an
  # organization could take its sign-in over was to ask us to do it for them.
  # These scenarios are the door, and what the administrator is promised
  # before they touch it.
  #
  # The words matter as much as the door. What the organization is doing is
  # replacing the sign-in it has with one it owns, and every line it reads
  # says that; nothing a customer sees calls it a migration.

  @integration
  Scenario: An organization is offered its own identity provider on the Authentication overview
    Given an organization signs in through single sign-on LangWatch set up for it
    When its administrator opens Authentication
    Then they are told they can connect their own identity provider
    And one action takes them to the step that does it

  @integration
  Scenario: Connecting your own identity provider keeps today's sign-in working
    Given an organization signs in through single sign-on LangWatch set up for it
    When its administrator opens single sign-on setup
    Then they are offered the same form the first-time journey asks
    And they are told everyone keeps signing in as they do today, that nothing
    changes for members until an administrator switches over, and that they
    can switch back
    And submitting it registers their identity provider beside the one in use

  @integration
  Scenario: A reader who may not manage single sign-on is told who can update it
    Given an organization signs in through single sign-on LangWatch set up for it
    And the reader may see single sign-on but not change it
    When they open single sign-on setup
    Then they read the status of their sign-in
    And no form and no disabled action is offered

  @integration
  Scenario: Once it is under way, the overview says where the update got to
    Given an organization has registered its own identity provider beside the
    one in use
    When its administrator opens Authentication
    Then the overview says where the update stands, in the same words the
    single sign-on page uses
    And it links to that page

  @integration
  Scenario: The update reports where it stands and what is outstanding
    Given an organization has registered its own identity provider beside the
    one in use
    When its administrator opens single sign-on setup
    Then they read who is signing people in right now
    And every outstanding check says what to do about it
    And the full list of what has to be true before the update can finish is
    available without leaving the page

  @unit
  Scenario: An organization not on an Enterprise plan is told the plan is what refuses
    Given the organization is not on an Enterprise plan
    When its administrator connects their own identity provider
    Then the request is refused with "enterprise_plan_required"
    And the words the administrator reads are the plan's, not a generic failure

  # Starting twice is refused by the one-replacement rule already stated under
  # "What stops registration being an enumeration rail", so it is not restated
  # here.

  @integration
  Scenario: Identity provider details that do not work are reported on the form
    Given an administrator connecting their own identity provider
    When the details they give are refused
    Then the reason is shown with the fields they filled in, not as a
    notification that disappears

  @integration
  Scenario: Registering is acknowledged rather than left to be inferred
    Given an administrator who has filled the registration form in
    When they submit it and the command succeeds
    Then they are told it was registered, and what to do next
    And the form stays busy until the screen holds the new connection

  @integration
  Scenario: The administrator chooses which kind of provider they have
    When an administrator opens the registration form
    Then they can choose OpenID Connect or SAML, named by protocol and
    described by what the administrator holds
    And choosing OpenID Connect asks for an issuer address, a client id and a
    client secret
    And choosing SAML asks for the identity provider's metadata or its
    sign-in address, entity id and certificate

  @integration
  Scenario: A reader who may not manage single sign-on is offered no form
    Given the administrator may see single sign-on but not change it
    When they open single sign-on setup
    Then no registration form is rendered

  @integration @regression
  Scenario: Migration progress recognizes native identifiers without connection annotations
    Given an organization member signed in through its direct replacement
    And the adopted identifier carries its native provider and subject
    When migration readiness is read
    Then the member counts as linked to the replacement
    But an explicit association to another connection is not overridden

  @integration @regression
  Scenario: Legacy adoption evidence keeps sibling providers separate
    Given a member has an adopted brokered identifier without a connection annotation
    When its provider and subject match the legacy connection
    Then its account counts as associated for migration
    But a similarly named sibling provider does not count

  @integration @regression
  Scenario: Native legacy retirement leaves every member a way in
    Given a legacy identifier was adopted without a connection annotation
    When its legacy access is retired
    Then it is taken away from a user who keeps a verified replacement identifier or another verified way in, which becomes primary where the legacy one was
    And accounts belonging only to another organization remain untouched

  @unit @regression
  Scenario: Metadata-only SAML registration requires a usable signing certificate
    When identity provider metadata has no signing key or only an encryption key
    Then registration is refused with sso_saml_metadata_invalid
    And metadata with a usable signing key or a separately supplied certificate is accepted
