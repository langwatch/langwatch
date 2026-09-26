Feature: Why a single sign-on assertion was turned away
  As somebody whose identity provider just signed them in successfully, only
  for LangWatch to refuse them
  I need to be told which kind of thing is wrong, and my administrator needs
  to be told exactly what to fix
  So that a refusal is the start of fixing something rather than a dead end

  # WHAT THIS IS ABOUT. `SsoAssertionService.decide` is the gate that runs
  # BEFORE better-auth links an asserted identity to anybody. It can refuse
  # for distinct reasons and, until this feature, answered them all
  # with one code - `identity_sign_in_refused`, whose customer copy reads
  # "That email or password is wrong". On this path there was no password.
  # The one sentence the refusal said was false.
  #
  # Worse, it said it NOWHERE ELSE. The refusal wrote no log line at all, so
  # the only record of which had fired was the code in somebody's address bar
  # - and that code was the same for all of them. Diagnosing a
  # refused sign-in meant reading the database by hand.
  #
  # THE RULE, in one line: a refusal names its cause when the cause is a fact
  # about the CALLER'S OWN assertion or their own organization's
  # configuration - something they or their administrator can change. It stays
  # opaque when the cause is a fact about WHAT EXISTS INSIDE LANGWATCH. That
  # is ADR-045's test ("we know the cause and the caller can act on it") with
  # the existence-oracle carved out of it, and it sorts them cleanly.
  #
  # TWO READERS, ONE REFUSAL. The person bounced to the sign-in error screen
  # is usually not the person who can fix it, and "ask your administrator" is
  # useless when you ARE the administrator - which is exactly what the setup
  # journey hands them. So the same code is read twice: the public screen
  # renders the category, and the single sign-on settings screen, where the
  # reader is already authenticated and owns the connection, renders the
  # remedy. No new server state - the test sign-in already returns to that
  # screen carrying the code.

  Background:
    Given an organization "acme" with a single sign-on connection
    And "ana" is the administrator who registered it

  Rule: the cause is always written down where we can read it

    @unit
    Scenario: Every refusal logs its reason
      Given an assertion that will be refused
      When the gate refuses it
      Then the log line names the reason, the connection and the organization
      And it names the domain that was asserted
      # The half that was missing entirely. Every other scenario in this file
      # is about what a person is told; this one is about the fact that we
      # could not tell ourselves either.

    @unit
    Scenario: A connection with no registrant recorded is logged as our fault
      Given a connection whose "createdBy" is empty
      When somebody signs in through it
      Then they are refused without being told why
      And the failure is logged at error rather than as routine
      # A row in this state should not exist. The customer cannot act on it
      # and must not be told about it, but it is not a refusal to shrug at
      # either: it is ours to go and fix.

    @unit
    Scenario: A callback for a suspended or removed connection is refused
      Given the connection is suspended or its removal has completed
      When its registrant's identity provider sends a callback
      Then the callback is refused before identity linking
      And the failure is logged as a connection that no longer accepts sign-in
      # The provider is removed from the dialable set in these states, but an
      # in-flight or stale callback still reaches this boundary. The setup
      # registrant exception applies only while a connection is on its setup
      # path.

    @unit
    Scenario: Go-live readiness does not survive suspension or teardown
      Given the connection proved its domain, decided what an arrival gets and
        has a live break-glass grant
      And the connection is suspended or its removal has completed
      When its identity provider sends a callback for that proved domain
      Then the callback is refused before identity linking
      # Suspension and teardown preserve every one of those settings, so the
      # readiness exemption would still be satisfied by a connection whose
      # administrator has closed the door. Readiness belongs to the setup path
      # and ends with it.

  Rule: a connection that has done everything but the sign-in is trusted for it

    # THE DEADLOCK THIS BREAKS, and it made setup impossible rather than
    # merely awkward. Activation refuses without a real sign-in through the
    # connection; a connection that was not ACTIVE accepted exactly one
    # address, the one on the account that registered it. So an administrator
    # whose identity provider asserts anything other than their own LangWatch
    # address could never finish: the sign-in needed to activate was refused
    # because the connection was not activated. Every screen said to verify
    # the domain, and verifying it released nothing — a proved domain was only
    # ever consulted once the connection was already live.
    #
    # IT IS NOT A WIDENING OF WHO GETS ROUTED. Routing answers ACTIVE only for
    # a connection in state ACTIVE, and none of this touches it, so no
    # ordinary sign-in changes door. This decides only whether an assertion
    # that deliberately dialed the connection is accepted — which before
    # activation is the administrator proving it works.

    @unit
    Scenario: A proved domain carries the sign-in that would activate it
      Given "acme" has proved the asserted domain
      And somebody can still get in without the identity provider
      And "ana" has said what the connection does with an arrival
      When its identity provider asserts an address on that domain
      Then the sign-in is carried through
      # Activation's own preconditions, minus the one being attempted.

    @unit
    Scenario: Missing any other precondition keeps the setup rule
      Given "acme" has proved the asserted domain
      But nobody can get in without the identity provider
      When its identity provider asserts an address on that domain
      Then only the registrant's own address is carried through
      # The break-glass grant is what stops a connection admitting people it
      # could then strand, so its absence holds the door exactly as before.

    @unit
    Scenario: An unproved domain is never carried by readiness
      Given "acme" has not proved the asserted domain
      And every other go-live precondition is met
      When its identity provider asserts an address on that domain
      Then only the registrant's own address is carried through
      # The proof is the entire basis for trusting the provider's word, so no
      # amount of other readiness substitutes for it.

    @unit
    Scenario: A live connection asks nothing extra
      Given "acme" has turned its connection on
      When anybody signs in through it
      Then no readiness question is asked of the database
      # This runs on every single sign-on request in the product. The two
      # in-memory facts are checked first and the stored one last, so the
      # ordinary path costs exactly what it did.

  Rule: a cause the caller or their administrator can change is named

    @unit
    Scenario: The identity provider released no email address
      Given the provider asserts an identity carrying no email address
      When the gate reads it
      Then the refusal says the provider sent no email address
      # The single most common enterprise misconfiguration, and a fact about
      # the customer's OWN assertion - it discloses nothing of ours.

    @unit
    Scenario: The provider asserted an address the connection cannot carry yet
      Given the connection has not gone live yet
      And the asserted address is not the registrant's
      When the gate reads it
      Then the refusal says the address was not the registrant's
      And it names neither the registrant nor any address
      # NAMED FOR THE ADDRESS, NOT FOR THE CONNECTION'S STATE, and the
      # difference is the whole usefulness of it. This fires during the setup
      # journey, whose own instructions tell an administrator to go and prove
      # the connection with a real sign-in — so a refusal reading "this
      # connection is still being set up" tells the one person who is supposed
      # to act that they may not. What actually happened is narrower and
      # fixable: their provider asserted an address that is not on the account
      # which registered the connection.

    @integration
    Scenario: The administrator is told the ways out of an address mismatch
      Given "ana" registered the connection with her LangWatch address
      And her identity provider signs her in as a different address
      When she runs the test sign-in
      Then she is offered signing in as the address on her account, adding the
      provider's address to her account, and verifying the domain
      # WITHOUT THE MIDDLE ONE THE JOURNEY CAN DEAD-END. An administrator
      # whose LangWatch address differs from the identity their provider
      # asserts cannot complete setup at all: the exemption matches the
      # registrant's account, activation refuses without a real sign-in, and
      # verifying the domain is not always theirs to do today. Adding the
      # provider's address to their own account and verifying it is the way
      # through, and nothing said so.

    @unit
    Scenario: The asserted domain is not one the connection has proved
      Given the connection is live
      And the provider asserts an address on a domain it has not proved
      When the gate reads it
      Then the refusal says that domain is not verified for this connection

    @unit
    Scenario: The domain's proof has lapsed and this account is new
      Given the connection's proof for the asserted domain has lapsed
      And the account has never signed in through this connection before
      When the gate reads it
      Then the refusal says the domain's verification has lapsed
      # ADR-123: a lapsed domain still routes for the people already here and
      # admits nobody new. The person turned away is new, so the remedy is an
      # administrator republishing the record - which is worth saying.

  Rule: a cause that would answer "does this exist in LangWatch" stays opaque

    @unit
    Scenario: The named provider is not a connection at all
      When an assertion names something that is not a connection
      Then it is refused with the general single sign-on refusal
      And the refusal does not say what was wrong with the name

    @unit
    Scenario: No such connection is held
      When an assertion names a connection we do not hold
      Then it is refused with the general single sign-on refusal
      And a connection that exists but refuses is refused identically
      # The two must be indistinguishable, or the refusal becomes a way to
      # enumerate which connection identifiers are real.

  Rule: the general refusal stops claiming a password was wrong

    @unit
    Scenario: The opaque refusal is not the credential refusal
      Given an assertion refused for a reason we will not name
      When the person reads what they are told
      Then it does not mention a password
      And it does not say their email address was wrong
      # `identity_sign_in_refused` means "that email or password is wrong" and
      # has to keep meaning exactly that - it is load-bearing for the
      # enumeration property on the credential screen. Single sign-on gets its
      # own general refusal rather than borrowing words written for a form it
      # never went through.

  Rule: the administrator testing their own connection is told the remedy

    @integration
    Scenario: A test sign-in explains itself on the settings screen
      Given "ana" runs a test sign-in that the gate refuses
      When she is returned to the single sign-on settings screen
      Then she is told what to fix rather than the category
      And the refusal is not attributed to her identity provider
      # It came from us. The failure notice on that screen quotes whatever
      # came back as "your identity provider sent you back with an error",
      # which for our own refusal names the wrong culprit and sends an
      # administrator to go and debug a correctly configured provider.

    @integration
    Scenario: A provider's own error is still quoted verbatim
      Given a test sign-in that the provider itself rejects
      When "ana" is returned to the settings screen
      Then the provider's words are shown unchanged
      # Our codes get our copy; everything else keeps the behaviour that
      # exists, because there is no copy of ours to write for somebody else's
      # sentence.

  Rule: a lapsed proof asks to be re-checked

    # HALF BUILT, and tagged honestly. The gate ASKS — it calls the re-proof
    # port on exactly this refusal, swallows a failure so a 403 can never
    # become a 500, and both of those are covered below. What is not built is
    # anything that ANSWERS: the re-proof pipeline is a scheduled global sweep
    # with no event handlers, so waking it on demand means appending an event
    # from the sign-in path and subscribing the process manager to it. Until
    # that lands the port is unwired in the composition root, and a lapsed
    # domain is re-read on the ordinary eight-hourly tick exactly as before.

    @unit
    Scenario: The gate asks for a re-read when it refuses somebody new
      Given the connection's proof for the asserted domain has lapsed
      When somebody is refused because of it
      Then a re-proof of that domain is asked for
      And the refusal still stands if that request fails
      # The second half is the load-bearing one: a refusal that could not ask
      # is still a refusal, and turning a 403 carrying words somebody can act
      # on into a 500 carrying none would be a worse bug than the lapse.

    @unit
    Scenario: Somebody already bound to the connection asks for nothing
      Given the connection's proof for the asserted domain has lapsed
      And the account already signs in through this connection
      When they sign in
      Then they are carried through
      And no re-proof is asked for
      # ADR-123: a lapsed domain keeps signing in the people already there.
      # Nobody was turned away, so there is nothing to go and re-check.

    @unimplemented
    Scenario: Being refused for a lapsed proof schedules a re-read of the record
      Given the connection's proof for the asserted domain has lapsed
      When somebody is refused because of it
      Then a re-proof of that domain is enqueued
      And the sign-in path performs no name resolution itself
      # The record is often simply back: the sweep runs every eight hours and
      # the refusal is evidence somebody is being turned away right now. The
      # lookup happens behind the outbox lease, so it adds no latency to a
      # sign-in and no DNS call to a request path.

    @unimplemented
    Scenario: The re-proof is asked for once, not once per attempt
      Given a domain whose proof has lapsed
      When five people are refused for it in quick succession
      Then the re-proof is enqueued once
      # An intent keyed on the domain rather than on the attempt. A provider
      # retrying a redirect loop must not turn into a burst of lookups
      # against somebody else's nameservers.
