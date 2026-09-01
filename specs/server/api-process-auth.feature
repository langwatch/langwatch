Feature: The standalone API process composes its own Auth service
  As an operator running a LangWatch API deployment
  I want the API process to build the Auth service its request policy reads
  So that a deployment hands it one Better Auth instance and nothing else

  # WHY THIS EXISTS
  #
  # `API_UNAVAILABLE_PRODUCT_ADAPTERS` named "IdentityEmailService and the
  # Better Auth browser-session transport" as one entry, because both arrive
  # through one option: `ApiAuthSessionCompositionPort` hands the Auth service
  # and the transport over as a pair. They were never one gap.
  #
  # `IdentityEmailService` was not process-bound. It answers which address is a
  # person's from the `Identifier` projection, for a user whose backfill has
  # finalized, and both halves are reads over the client this process already
  # composes. `PostgresIdentityEmailAdapter` is both, and with it the whole
  # Auth service composes here — the packaged user service under it too, its
  # avatar storage declared absent because reading a profile needs no object
  # store and writing one does.
  #
  # The transport genuinely is. It is one configured Better Auth server
  # instance, and every option that decides whether a cookie verifies belongs
  # to the deployment: the signing secret, the base URL and trusted origins,
  # the cookie prefix, the session model mapping, the secondary-storage prefix,
  # the mounted social and generic-OIDC providers whose ids a stored account
  # row is keyed by, the identity storage adapter, and the request hooks. A
  # second instance composed here from a different option set would not fail —
  # it would verify nothing and answer null, which every caller reads as
  # "signed out".

  Rule: A process with a database and a transport composes the Auth service

    @unit
    Scenario: The API process composes its own Auth service
      Given the deployment configured a database
      And a host supplied the deployment's Better Auth transport
      And no host supplied an Auth composition
      When the process composes
      Then it builds the Auth service over its own guarded client
      And the request policy authenticates through it

    @unit
    Scenario: An injected Auth composition is the one the process authenticates with
      Given a host supplies the API process with its own Auth service and transport
      When the process composes
      Then callers are authenticated by the host's composition
      And the process composes none of its own
      # Two Auth services in one process would read the same session rows
      # through two graphs, and only one of them is the one a host can observe.

    @unit
    Scenario: A process with no browser-session transport mounts no product transports
      Given the deployment configured a database
      And no host supplied a browser-session transport or an Auth composition
      When the process composes
      Then it composes no Auth service, and names the missing transport at boot
      And no product transport is mounted
      # Absent rather than mounted, and this gap is the sharpest of the three
      # the process can have: a policy built over a transport that verifies
      # nothing does not fail, it answers "signed out" to everybody.

    @unit
    Scenario: A process with no database composes no Auth service
      Given the deployment configured no database
      And a host supplied only a browser-session transport
      When the process composes
      Then it composes no Auth service, and names the missing half at boot

    @unit
    Scenario: A process with no organization service composes no Auth service
      Given the process resolved no organization service
      When it composes the Auth graph
      Then it composes no Auth service, and names the missing half at boot
      # The user service the Auth service reads a profile through resolves a
      # person's personal workspace, so there is no Auth graph without one.

  Rule: The session a composed Auth service answers with reads the identifiers

    @unit
    Scenario: A finalized user's session carries their identifier address
      Given the process composed its own Auth service
      And the signed-in user's identifier backfill has finalized
      And their identifiers name a different address from the User row
      When the process resolves that user's browser session
      Then the session carries the identifier's address
      # This is what closing the IdentityEmailService entry buys: without the
      # read fork the process would hand back the stale legacy column.

    @unit
    Scenario: An unenrolled user's session carries the stored column
      Given the process composed its own Auth service
      And no user in the deployment has finalized the identifier backfill
      When the process resolves a user's browser session
      Then the session carries the address on the User row
      # The packaged user service under the Auth service is what answers here,
      # so this proves both halves of the composed graph rather than one.

  Rule: A presented session token is never rejected silently

    @unit
    Scenario: A session token Better Auth rejects is logged as a refusal
      Given a request carrying a Better Auth session token
      And the transport resolves no verified session for it
      When the process authenticates the request
      Then the caller is anonymous
      And the refusal is logged with the cookie name it arrived under
      # A Better Auth misconfiguration has taken sign-in down in production
      # once, and it stayed expensive because the refusal was indistinguishable
      # from an anonymous request. The cookie VALUE is never recorded.

    @unit
    Scenario: An anonymous request is not logged as a refusal
      Given a request carrying no session cookie
      When the process authenticates the request
      Then the caller is anonymous
      And nothing is logged
      # Otherwise every unauthenticated call to a public route would look like
      # a rejected credential, and the signal that matters would be buried.

    @unit
    Scenario: A verified session the Auth service cannot resolve is logged
      Given Better Auth verifies a session token
      And the Auth service finds no live session behind it
      When the process authenticates the request
      Then the caller is anonymous
      And the unresolved session is logged with its identifiers

    @unit
    Scenario: A transport that throws still leaves the caller anonymous
      Given the Better Auth lookup fails
      When the process authenticates the request
      Then the caller is anonymous
      And the failure is logged as an error

    @unit
    Scenario: An Auth service that throws still leaves the caller anonymous
      Given Better Auth verifies a session token
      And the Auth service throws resolving it
      When the process authenticates the request
      Then the caller is anonymous
      # A read fork or a database blip on this path must never turn into a
      # failed request; it turns into an unauthenticated one.

  Rule: The capability it cannot compose is announced

    @unit
    Scenario: The unavailable-adapter list names only the Better Auth transport
      Given the API package composes the Auth service from packaged adapters
      When a deployment reads the process's boot statement
      Then IdentityEmailService is not on it
      And the deployment's Better Auth transport is

    @unit
    Scenario: An avatar upload refuses by name on a process with no stored objects
      Given the process composed its user service with no stored-object application
      When somebody uploads an avatar through it
      Then the write refuses and names the process
      # Accepting the bytes and dropping them would answer a customer's upload
      # with success and no picture.
