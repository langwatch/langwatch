Feature: The API process authenticates through the installed auth module
  As an operator running a LangWatch API deployment
  I want the API process to refuse to boot without the module that verifies a caller
  So that no product transport mounts over a door that verifies nothing

  # The auth module binds the process's one API door: sessions, the identities
  # a family may name, the authz reads and the audit sinks. A process that
  # installs no module binding the door refuses to boot, naming "auth"; two
  # that bind it refuse too (record section 8). The one Better Auth instance is
  # auth's own: a second, built from another option set, would answer "signed
  # out" to everybody rather than fail. No host injects a service or transport.

  Rule: a process verifies callers through exactly one installed module

    @unit
    Scenario: A process that installs no module binding the API door refuses to boot, naming auth
      Given a process whose installed modules bind no API door
      When the API surface is composed at boot
      Then the boot refuses, naming the auth module to install
      And no product transport is mounted

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

  Rule: An absence is announced by whatever ran into it

    # The executable used to announce, at WARN on every boot, that it had
    # started "without an adapter no package implements" and would mount no
    # product transports — and then, on the next line, compose its own Better
    # Auth over the stock Prisma storage engine and mount them. The
    # announcement only ever looked at the two host-injected overrides, never
    # at the deployment's own browser-session identity, which is what actually
    # lets the process build one. A boot statement that is contradicted by the
    # line under it is worse than no boot statement.

    @integration
    Scenario: A process that composes its own browser sessions announces no absence
      Given a deployment that supplies no Better Auth transport but names its own browser-session identity
      When the API process starts
      Then it does not announce that transport as one nobody supplied
      And what it says about Better Auth describes the one it composed

    @unit
    Scenario: A process that can compose no browser sessions says so, with the reason
      Given a deployment that supplies no Better Auth transport and names no browser-session identity
      When the API process starts
      Then the composition that could not build one says so, naming the reason

    @unit
    Scenario: An avatar upload refuses by name on a process with no stored objects
      Given the process composed its user service with no stored-object application
      When somebody uploads an avatar through it
      Then the write refuses and names the process
      # Accepting the bytes and dropping them would answer a customer's upload
      # with success and no picture.

  # The API process reads its user directory through the user application it
  # installs. It used to wrap that application in an adapter that refused the
  # address lookup and the two account mints, so passkey sign-up and directory
  # provisioning were dead on this process while both modules behind them still
  # worked. The directory is the application now, and it answers all three.
  Rule: The process's user directory publishes the mints its ceremonies need

    @integration
    Scenario: A passkey ceremony mints its account through the process's directory
      Given the API process composed its user application
      When a passkey sign-up completes for an address nobody holds
      Then the account is created and the ceremony is told which one it is

    @integration
    Scenario: A passkey ceremony is refused for an address that already has an account
      Given the API process composed its user application
      When a passkey sign-up starts for an address somebody already holds
      Then it is refused before any account is minted

    @integration
    Scenario: A directory push mints an account through the process's directory
      Given the API process composed its user application
      When a directory push names somebody the deployment does not know
      Then the address is looked up and the account is created
