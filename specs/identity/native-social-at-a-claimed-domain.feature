Feature: A native social button at a domain somebody's connection proved
  As an organization whose people sign in through our own identity provider
  I need a colleague who presses "Continue with Google" to end up at that provider
  So that the door the organization chose is the door everybody walks through,
  and nobody lands in a dead end or beside the organization entirely

  # THE BUTTON THAT SKIPS THE ROUTER.
  #
  # The front door is address-first: somebody types sam@acme.com, the router
  # reads the connection projection before the legacy columns, and a live
  # proved domain outranks everything - `redirect_to_connection`, no Google
  # button drawn (specs/identity/signin-router.feature). The credential
  # boundary asks the same router, so `/sign-in/email` is refused for an
  # address an organization governs.
  #
  # A social button is pressed BEFORE any address is typed. Nothing on that
  # path carries one, so the router never sees it, and the first moment this
  # deployment knows who arrived is the callback - by which point better-auth
  # is already creating the account.
  #
  # #8149 closed the half of this that the LEGACY columns answer: a native
  # provider at an organization whose `Organization.ssoDomain` matches is
  # refused outright, on both the create and the update seam
  # (specs/auth/phase-1-better-auth-config.feature). That guard reads
  # `ssoDomain`, and a self-serve connection never writes it - so every
  # organization that registered its own connection, which is the whole point
  # of the self-serve journey, was not covered by it at all. This file is that
  # half.
  #
  # AND IT BOUNCES RATHER THAN REFUSING. The legacy guard's answer is an error
  # page reading "use your organization's sign-in", which asks the person to go
  # back and type the address they just proved they have. Here the connection
  # is KNOWN at the moment of refusal - it is what made the refusal - so the
  # refusal carries it and the error route dials it. What the person sees is
  # their own provider, not a page about why they cannot have Google.
  #
  # WHAT HAPPENS WHEN THEY GET THERE is not this file's: the connection's
  # arrival policy admits them or queues a request
  # (specs/identity/join-requests.feature, specs/identity/sso-connection-lifecycle.feature),
  # and a pending invite outranks both. The point of bouncing rather than
  # refusing is that those rules get to run at all.

  Rule: A domain a live connection proved is that connection's, whichever button was pressed

    # The same three questions the arrival door asks - live, proved, not
    # lapsed - because a refusal that used a different standard than the
    # admission would turn somebody away from a door that would have let
    # them in.

    @unit
    Scenario: A native social sign-up on a proved domain is refused
      Given an organization whose connection is live and has proved "acme.com"
      When somebody with an "acme.com" address signs up with Google
      Then the account is refused before any Google identity is attached to them

    @unit
    Scenario: The refusal names the connection, so it can be walked into
      Given an organization whose connection is live and has proved "acme.com"
      When somebody with an "acme.com" address signs up with Google
      Then the refusal carries that connection as where they should go instead

    @unit
    Scenario: An already-linked native account is refused on the sign-in path too
      Given somebody holds a Google account linked before the connection went live
      And their organization's connection is live and has proved "acme.com"
      When they sign in with Google again
      Then the sign-in is refused, because no account row is created on that path

    @integration
    Scenario: A domain the connection never proved is not the connection's
      Given an organization whose connection is live but has proved only "acme.com"
      When somebody with a "notacme.com" address signs up with Google
      Then the sign-up proceeds, because no organization claims that domain

    @integration
    Scenario: A connection still being set up governs nobody
      Given an organization whose connection has proved "acme.com" but is not live yet
      When somebody with an "acme.com" address signs up with Google
      Then the sign-up proceeds, because the organization has not turned it on

    # ADR-123: a lapsed domain still ROUTES, so people who already work there
    # keep signing in, and stops PROVISIONING. Routing is what this rule is,
    # so the refusal stands - and the arrival door is the one that then admits
    # nobody new.
    @integration
    Scenario: A domain whose proof has lapsed still sends them to the provider
      Given an organization whose connection is live and whose proof of "acme.com" has lapsed
      When somebody with an "acme.com" address signs up with Google
      Then the sign-up is still refused and still names the connection

    @unit
    Scenario: The connection dialling itself is not a native button
      Given an organization whose connection is live and has proved "acme.com"
      When somebody signs in through that connection
      Then nothing refuses them, because the provider IS the connection

    @unit
    Scenario: A brokered sign-in mid-migration is left alone
      Given an organization whose connection is live and has proved "acme.com"
      When somebody signs in through the broker on one of its other connections
      Then nothing refuses them, because that is the population the migration flag is for

  Rule: The refusal is a bounce, and the bounce cannot be pointed anywhere

    @integration
    Scenario: The error route dials the connection the refusal named
      Given a refused native sign-in that named a connection
      When the person lands on the error route
      Then they are sent straight to that connection's sign-in without being asked anything

    # The bounce target arrives as a query parameter, which means anybody can
    # write one. It is read as a connection IDENTIFIER and the address is built
    # here; a parameter that is not one is not followed.
    @integration
    Scenario: A bounce target that is not a connection identifier is refused
      Given a refusal whose named target is an external address rather than a connection
      When the person lands on the error route
      Then nothing is dialled and the ordinary refusal is shown instead
