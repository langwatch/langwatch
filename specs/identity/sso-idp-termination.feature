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
    And an organization's connection names that provider
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

  @unimplemented
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
