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

  # --- Social sign-in ---------------------------------------------------

  @unit
  Scenario: Signing in with GitHub at the simulator round-trips a GitHub-shaped profile
    Given a client sent through the tenant's GitHub authorize endpoint as a seeded user
    When the client exchanges the code without asking for JSON
    Then the token endpoint answers a form-encoded bearer access token, as GitHub does
    And the user and user emails endpoints return the person with a numeric id and a primary verified address
    And the tenant's activity records the GitHub authorize, token and profile reads

  @unit
  Scenario: Signing in with Google or Microsoft at the simulator returns a signed ID token in the provider's shape
    Given a client sent through the tenant's Google or Microsoft authorize endpoint as a seeded user
    When the client exchanges the code
    Then the ID token verifies against the tenant's published keys
    And a Google token carries a 21-digit subject under the tenant's Google issuer
    And a Microsoft token carries the tenant's directory id under its Entra v2.0 issuer

  @unit
  Scenario: The social account picker links back into the provider and can be cancelled
    When a client is sent through a social provider's authorize endpoint with no login hint
    Then the account picker names the provider and links each person back into that provider's endpoint
    When the person presses Cancel
    Then the client is sent back access_denied with its state and no code
    And the tenant's activity records the refusal

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

  # --- Provisioning into LangWatch --------------------------------------

  # SCIM only ever runs one way: the identity provider sends its directory to
  # the application, so the application issues the credential. LangWatch mints
  # its SCIM token -- or takes one the administrator already had -- and the
  # provider presents it. A token the simulator generated would open nothing,
  # so the tenant takes one rather than inventing one, exactly as it takes a
  # domain verification value rather than minting it.
  @unit
  Scenario: A tenant is given the address and token of the application it provisions into
    Given LangWatch has issued a SCIM token
    When an administrator connects the tenant to LangWatch's SCIM address with that token
    Then the tenant reports it is provisioning into that address
    And only enough of the token is shown to recognize which one was pasted
    But an address nothing can be sent to is refused rather than stored

  # The page carries two SCIM tokens pointing opposite ways, and only one of
  # them can be copied -- so the one on the clipboard is the wrong one.
  @unit
  Scenario: The tenant's own SCIM token is refused as the token to provision with
    When an administrator pastes the tenant's own SCIM token as the application's
    Then the connection is refused, naming which end each token belongs to

  @unit
  Scenario: A connected tenant pushes its directory without being told where again
    Given a tenant connected to a SCIM service provider
    When the tenant is asked to push its directory
    Then the users and groups arrive at the connected address carrying the connected token
    And the push is recorded in the tenant's activity with what landed

  @unit
  Scenario: What the application ended up holding can be read back
    Given a tenant connected to a SCIM service provider
    When the tenant is asked to read the directory back
    Then it reports the users and groups the application says it holds
    And a target that refuses the read says so rather than reading as empty

  @unit
  Scenario: Resetting a tenant's users does not forget where it provisions
    Given a tenant connected to a SCIM service provider
    When the control API resets the tenant
    Then the connection is still there, because putting the seeded users back
      is not a reason to forget where they were going

  # A real identity provider pushes a group by the ids the RECEIVING service
  # minted for its people, not by its own. Sending its own ids writes a group
  # of members nobody can resolve, which a target accepts and then shows
  # empty — so a sync that reads as four groups written is four groups of
  # nobody.

  @unit
  Scenario: Group sync references the receiving service's users and repeats without writes
    Given a tenant connected to a SCIM service provider
    When the tenant pushes its directory twice with groups turned on
    Then the groups arrive naming the members by the ids the target minted
    And the second push writes no group, because nothing changed
    And a membership the tenant then changes is written once and no more
    And somebody the tenant marks inactive stops being a member

  @unit
  Scenario: Group sync reports target failures instead of claiming success
    Given a SCIM service provider that refuses every group write
    When the tenant pushes its directory with groups turned on
    Then the push reports a failure for each group it could not write
    And each failure names what the target answered
    And the people it did provision are still reported as created

  @unit
  Scenario: Directory readback follows every page of users and groups
    Given a tenant of 250 people and 5 groups pushed at a service provider that pages
    When the directory is read back
    Then everybody and every group is reported exactly once
    And the next push reports them all as unchanged

  @unit
  Scenario: An inactive person removed by the target is not provisioned again
    Given somebody the tenant has marked inactive whose resource the target deleted
    When the tenant pushes its directory again
    Then nobody is created and nobody is updated
    And the target still does not hold them
    # A service provider that removes the resource on deactivation would
    # otherwise be handed the person back on every pass, for ever.

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
    When the developer runs `haven simulator idp`
    Then only the simulator process starts — no app, API, workers or databases
    And it is routed at the machine-wide idp hostname while the proxy is available

  @unit
  Scenario: A worktree running the idp lane routes it by hostname
    Given a worktree with the idp lane selected
    When the stack is planned
    Then the idp service is planned with its own hostname under the worktree's slug

  # The landing page listed twelve identical cards and a paragraph of eleven
  # control-API paths run together. Both are true; neither tells someone opening
  # it for the first time what they are supposed to do with it.

  @unit
  Scenario: The landing page says what to do before it lists the providers
    Given someone opening the simulator for the first time
    When they read the page top to bottom
    Then it names the three steps in order before it lists the providers
    And the machine's own base address is on the page and copyable
    And the control API is folded away, each request saying what it does

  @unit
  Scenario: A provider that already has an application registered is marked as such
    Given one tenant with a registered application and several without
    When the landing page lists the providers
    Then only that tenant is marked, because it is the one being come back to

  # --- Faults: SAML tampers, clock skew, IdP-initiated, disabled users ---
  # Driven through the control API and `haven sim idp`, never a page. Every
  # fault is recorded in the tenant's activity.

  @unit
  Scenario: A SAML response can be broken once in each way a service provider must refuse
    Given a tenant armed with one of the SAML tamper modes
      | mode                      | what the next response carries                 |
      | saml-bad-signature        | signatures that no longer verify               |
      | saml-unsigned             | no signature on the response or the assertion  |
      | saml-wrong-audience       | an audience that is not the service provider   |
      | saml-wrong-recipient      | a recipient that is not the ACS URL            |
      | saml-expired              | a validity window that has already closed      |
      | saml-not-yet-valid        | a validity window that has not opened yet      |
      | saml-wrong-in-response-to | an InResponseTo naming no request it was sent  |
    When a service provider signs in through the tenant twice
    Then the first response is refused by a service provider that checks it
    And the second response verifies, because the break is one-shot
    And the tenant's activity shows the mode being armed and the response it broke

  @unit
  Scenario: A replayed SAML assertion repeats the previous assertion's ID
    Given a tenant that has already signed one assertion
    When the tenant is armed with saml-replayed-assertion and signs another
    Then the new assertion carries the previous assertion's ID
    And refusing the replay is left to the service provider

  @unit
  Scenario: An unknown tamper mode is refused
    When a tenant is armed with a mode it does not know
    Then the request is refused as a bad request listing the modes it does know
    And nothing is armed

  @unit
  Scenario: A tenant's clock can run ahead of or behind the service provider's
    Given a tenant whose clock is skewed by a number of seconds
    When a service provider signs in through the tenant
    Then a skew of ten minutes ahead is refused as not yet valid
    And a skew of ten minutes behind is refused as expired
    And a skew of thirty seconds is accepted inside the usual tolerance
    And the same skew moves the issued-at and expiry of the tenant's ID tokens
    And the tenant's activity shows the skew being set

  @unit
  Scenario: An unsolicited SAML response carries the chosen RelayState and no InResponseTo
    Given a tenant with an active user
    When the control API is asked for an unsolicited response to an ACS URL with a RelayState
    Then it returns the ACS URL, the signed response and the RelayState to post
    And the response names no request it answers
    And a service provider that accepts only solicited responses refuses it
    And one that allows IdP-initiated sign-in accepts it for that user
    And the tenant's activity records the RelayState it was sent with

  @unit
  Scenario: An unsolicited SAML response needs an ACS URL and an active user
    When an unsolicited response is asked for without an ACS URL
    Then the request is refused as a bad request
    When one is asked for a user the tenant does not have
    Then the request is refused as forbidden
    And the tenant's activity records the refusal

  @unit
  Scenario: A user disabled at the IdP is refused at sign-in
    Given a tenant whose user has been disabled through the control API
    When that user signs in over SAML, over OIDC or through an unsolicited response
    Then the tenant refuses each one itself, before anything reaches the service provider
    And the tenant's activity shows the user being disabled
    And a change naming no active flag is refused as a bad request
    And a change naming an unknown user is refused as not found

  @unit
  Scenario: Resetting a tenant clears its clock skew
    Given a tenant whose clock is skewed by ten minutes
    When the tenant is reset
    Then the tenant's clock runs true again
    And the next replayed SAML assertion has no previous assertion to repeat

  @unit
  Scenario: A tenant's clock skew survives a simulator restart
    Given a simulator that keeps its state on disk
    And a tenant whose clock is skewed by ten minutes
    When the simulator restarts
    Then the tenant's clock is still skewed by ten minutes

  @unit
  Scenario: After a key rotation both keys are published and the new one signs
    Given a tenant with one signing key
    When the tenant's signing key is rotated through the control API
    Then the tenant's JWKS publishes the new key and the previous one under different key ids
    And the tenant's SAML metadata publishes a signing certificate for each key
    And new ID tokens name the new key id and verify against the new key
    And new SAML assertions verify against the new certificate
    And the tenant's activity shows the rotation
    And a rotated tenant keeps both keys across a simulator restart

  @unit
  Scenario: After the previous key is dropped only the new one is published
    Given a tenant whose signing key has been rotated
    When the previous key is dropped through the control API
    Then the tenant's JWKS publishes only the new key
    And the tenant's SAML metadata publishes only the new signing certificate
    And dropping again when there is no previous key is refused as a conflict

  @unit
  Scenario: A token signed by a dropped key no longer verifies
    Given an ID token signed before the tenant's key was rotated
    When the key is rotated and the previous key is dropped
    Then the old token finds no matching key in the tenant's JWKS
    And a malformed rotation body is refused as a bad request

  # --- Console: directory and provider controls ---------------------------

  @integration
  Scenario: The console adds a person to a tenant's directory
    Given a tenant's Users tab is open in the console
    When the operator adds a person by email with a name and groups
    Then the console asks the simulator to add that person to the tenant
    And the directory is read again so the person appears

  @integration
  Scenario: The console disables and re-enables a person at the IdP
    Given a tenant's Users tab lists an active person
    When the operator disables that person
    Then the console asks the simulator to mark the person inactive
    And a refusal from the simulator is shown in its own words

  @integration
  Scenario: The console sends one SCIM event on demand
    Given a tenant's Provisioning tab is open in the console
    When the operator picks an event kind, a person and a PATCH style and sends it
    Then the console asks the simulator to send exactly that SCIM event
    And the status LangWatch answered with is shown

  @integration
  Scenario: The console sends an Auth0 SCIM webhook
    Given a tenant's Provisioning tab is open in the console
    When the operator sends an Auth0 deactivate event for a person to a stack with a secret
    Then the console asks the simulator to sign and send that webhook
    And the status the stack answered with is shown

  @integration
  Scenario: The console makes a tenant pose as a legacy provider and shows its env lines
    Given a tenant's Setup tab is open in the console
    When the operator picks Okta as the tenant's legacy provider
    Then the console asks the simulator to pose as Okta
    And it shows the issuer and the env lines that point a stack at the tenant

  @unit
  Scenario: The tenant page reads the keys, skew and armed break it signs with
    Given a tenant whose key was rotated, whose clock is skewed and which has a SAML break armed
    When the console reads the tenant
    Then it answers both published key ids, current first, the skew in seconds and the armed break

  @integration
  Scenario: The console rotates a tenant's key, skews its clock and arms a broken response
    Given a tenant's Signing tab is open in the console
    When the operator rotates the key, applies a clock skew and arms a SAML expired break
    Then the console asks the simulator for each through its control API
    And it shows which key signs and which is still published

  @integration
  Scenario: The console signs an IdP-initiated SAML response ready to post to the ACS
    Given a tenant's Signing tab is open in the console
    When the operator asks for an unsolicited response to an ACS address
    Then the console offers a form that posts the signed response and RelayState to that address

  # --- Console and CLI: proofs on any domain, advanced SCIM events -------

  @integration
  Scenario: The console publishes and removes a TXT record on any domain
    Given a tenant's Domain tab is open in the console
    When the operator publishes two TXT values at a domain no tenant owns, then removes them
    Then the console asks the simulator to set exactly those values at that name
    And then asks it to remove the record

  @integration
  Scenario: The console serves and stops the well-known verification file for a domain
    Given a tenant's Domain tab is open in the console
    When the operator serves a token for a domain, then stops serving it
    Then the console asks the simulator to serve that token as the domain's verification file
    And then asks it to stop

  @unit
  Scenario: haven sim idp verification sets and clears the well-known verification file
    When an agent runs `haven sim idp verification set` with a domain and a token
    Then the simulator is asked to serve that token for the domain
    And `haven sim idp verification clear` with the domain asks it to stop

  @integration
  Scenario: The console sends a SCIM event with ids, attributes and the enterprise extension
    Given a tenant's Provisioning tab is open on a connected tenant
    When the operator fills in the receiving side's id, attributes to set, inactive, no externalId and a department
    Then the console sends those fields in the SCIM event request
    And a line that is not key=value is refused before anything is sent

  @integration
  Scenario: The signing inputs follow the tenant after a reset
    Given a tenant's Signing tab shows a typed clock skew and a chosen break
    When the tenant is reset and read again
    Then the skew input and the break select show the tenant's own values
