Feature: Local IdP simulator (idpsim)
  A local Go service that plays the customer's identity provider so OIDC
  login, SAML login, SCIM provisioning and domain verification can be
  exercised end-to-end on a laptop, with no external IdP account. One
  process serves a range of independent tenants so many organizations'
  identity setups can be tested at once. haven runs it as an opt-in lane
  and routes it at idp.<slug>.langwatch.localhost.

  Background:
    Given the idpsim service is running with a range of tenants

  # --- OIDC -------------------------------------------------------------

  @unit
  Scenario: Each tenant publishes its own OIDC discovery document
    When a client fetches a tenant's OpenID configuration
    Then the issuer is that tenant's own base URL
    And the authorization, token, userinfo and JWKS endpoints all live under that issuer

  @unit
  Scenario: The authorization code flow completes without a real user
    Given a tenant with a seeded user
    When a client is sent through authorize with a redirect URI and a login hint
    And exchanges the returned code at the token endpoint
    Then it receives an ID token signed by that tenant's key
    And the ID token verifies against the tenant's published JWKS
    And the ID token carries the seeded user's subject and email

  @unit
  Scenario: An authorize request without a login hint offers the tenant's users
    When a client is sent through authorize with no login hint
    Then the response is an account picker listing the tenant's seeded users

  @unit
  Scenario: PKCE is enforced once a challenge was presented
    Given an authorization code minted with a PKCE challenge
    When the code is exchanged without the matching verifier
    Then the token endpoint refuses the exchange
    And exchanging with the correct verifier succeeds

  @unit
  Scenario: An authorization code is single-use
    Given a completed authorization
    When the same code is exchanged a second time
    Then the token endpoint refuses the exchange

  @unit
  Scenario: The userinfo endpoint returns the authenticated user's claims
    Given an access token from a completed authorization
    When the client calls userinfo with that token
    Then the response carries the user's subject, email and name

  @unit
  Scenario: A tenant can mint Auth0-style SAML-brokered subjects
    Given a tenant configured for SAML-brokered subjects
    When a client completes the authorization code flow
    Then the ID token's subject carries the samlp| prefix Auth0 uses for brokered SAML connections

  # --- Registering an application ---------------------------------------

  @unit
  Scenario: Registering an application hands back what the setup wizard asks for
    When an application is registered with a tenant under a name
    Then the tenant hands back an issuer address, a client id and a client secret
    And the client id and secret differ from every other application's

  @unit
  Scenario: A redirect address can be registered before the connection exists
    Given an application registered with a redirect address whose last segment is a placeholder
    When a client is sent through authorize with a real id in that segment
    Then the authorization succeeds
    And an address that differs anywhere else is still refused

  @unit
  Scenario: A registered application must present its client secret
    Given an application registered with a tenant
    When it completes authorize and exchanges the code with the wrong secret
    Then the token endpoint refuses the exchange as an invalid client
    And the authorization code is left unspent, so a retry with the right secret works

  @unit
  Scenario: A registered application may only be sent back to a registered address
    Given an application registered with one redirect address
    When it is sent through authorize naming a different address
    Then the request is refused on the page rather than bounced to that address
    And the refusal names both the application and the address it asked for

  @unit
  Scenario: A client the tenant does not know still works
    Given a tenant with a registered application
    When a client that registered nothing completes the authorization code flow
    Then it succeeds, because an unregistered client id is the zero-setup path

  # --- Watching a tenant -------------------------------------------------

  @unit
  Scenario: A tenant records what it has been asked to do
    Given a tenant that has served a login and refused a bad client secret
    When its activity is read
    Then both are listed newest-first, each with an outcome and a plain-language reason

  @unit
  Scenario: Directory and domain-verification traffic is recorded too
    When a user is provisioned over SCIM and a verifier fetches the domain token
    Then both appear in the owning tenant's activity

  # --- SAML -------------------------------------------------------------

  @unit
  Scenario: Each tenant publishes SAML IdP metadata with its signing certificate
    When a client fetches a tenant's SAML metadata
    Then it contains the tenant's entity ID, single sign-on URL and X.509 signing certificate

  @unit
  Scenario: A SAML authentication request produces a signed response for a seeded user
    Given a tenant with a seeded user
    When a service provider sends an authentication request to the tenant's SSO endpoint
    Then the simulator returns an auto-submitting form posting a SAML response
    And the response's assertion is signed by the tenant's certificate
    And the assertion names the seeded user

  # --- SCIM -------------------------------------------------------------

  @unit
  Scenario: SCIM requests without the tenant's bearer token are refused
    When a SCIM request carries a missing or wrong bearer token
    Then the simulator responds unauthorized

  @unit
  Scenario: Users can be provisioned and deprovisioned over SCIM
    When a SCIM client creates a user, lists users filtered by user name, and deactivates the user
    Then each operation succeeds with SCIM 2.0 response envelopes
    And the deactivated user reads back as inactive

  @unit
  Scenario: Groups can be managed over SCIM
    When a SCIM client creates a group and adds a provisioned user as a member
    Then the group reads back with that member

  @unit
  Scenario: A tenant's directory can be pushed at a SCIM service provider
    Given a tenant with seeded users
    When the control API is asked to push the tenant's directory at a SCIM target with a bearer token
    Then the target receives each user and group as SCIM 2.0 create requests carrying that token

  # --- Domain verification ---------------------------------------------

  @unit
  Scenario: A configured TXT record is served over DNS for verification
    Given a domain verification TXT record configured through the control API
    When a DNS client queries TXT for that domain against the simulator's DNS server
    Then the answer contains the configured verification value

  @unit
  Scenario: An unconfigured domain gets a name error over DNS
    When a DNS client queries TXT for a domain nobody configured
    Then the answer is a name error

  @unit
  Scenario: A busy verification DNS port does not stop the simulator
    Given something already holds the verification DNS port
    When the simulator starts
    Then it keeps serving OIDC, SAML, SCIM and HTTP verification
    And it says where it put the DNS listener instead

  @unit
  Scenario: A verification token is served over HTTP for non-DNS verification
    Given a well-known verification token configured through the control API
    When a client fetches the well-known verification path for that domain
    Then the response body is exactly the configured token

  # Proving a domain is the one step of single sign-on setup that happens
  # somewhere else: you leave the product, sign in to whoever administers the
  # domain, add a record, and come back. Locally there is no somewhere else --
  # a reserved name like acme.test has no registrar and no resolver answers
  # for it -- so the simulator is that registrar, and adding a record has to
  # be something a person does rather than a curl command a person is told
  # about. The value is LangWatch's, minted once and shown once; publishing
  # takes it rather than inventing one, because a proof against a token the
  # product never issued is a green tick that means nothing.
  @unit
  Scenario: A domain proof can be published from the simulator's own page
    Given LangWatch has minted a verification value for a domain
    When an administrator publishes that value in the simulator's DNS registry
    Then the TXT record answers at the name the verifier asks for
    And the same value is served as the well-known token
    But publishing without a value is refused rather than silently recorded

  @unit
  Scenario: A published record can be taken back out again
    Given a verification value published in the simulator's DNS registry
    When the administrator removes that record
    Then the TXT lookup stops finding it
    And the well-known token stops being served, so neither channel still proves it

  # --- Tenant range ------------------------------------------------------

  @unit
  Scenario: Tenants in the range are cryptographically isolated
    Given two tenants from the range
    Then their JWKS publish different keys
    And an ID token minted by one tenant fails verification against the other's JWKS

  @unit
  Scenario: The control API resets a tenant to its seeded state
    Given a tenant whose users were changed over SCIM
    When the control API resets the tenant
    Then the tenant reads back with only its seeded users

  # --- haven integration -------------------------------------------------

  @unit
  Scenario: The idp lane runs by default and can be turned off per worktree
    Given a fresh worktree
    Then haven's default selection runs the idp lane
    And `haven up -idp` turns the lane off for that worktree

  @unit
  Scenario: The simulator runs alone without the app stack
    Given no LangWatch stack is running
    When the developer runs `haven idp`
    Then only the simulator process starts — no app, API, workers or databases
    And it is routed at the machine-wide idp hostname while the proxy is available

  @unit
  Scenario: A worktree running the idp lane routes it by hostname
    Given a worktree with the idp lane selected
    When the stack is planned
    Then the idp service is planned with its own hostname under the worktree's slug
