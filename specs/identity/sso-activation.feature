Feature: Going live with your own identity provider, without asking us
  As the administrator of a company that has registered its identity provider
  with LangWatch
  I need to prove the connection works and turn it on myself
  So that rolling single sign-on out is an afternoon's work rather than a
  scheduled call with LangWatch

  # Wave 3, self-serve activation. D04 built the connection lifecycle, D05
  # built registration and the domain ceremony, and D09 made a sign-in
  # actually arrive. What was still missing is the last three steps: proving
  # the connection carries a real person, naming somebody who can still get
  # in if it breaks, and turning it on. All three existed only in the back
  # office, so every customer's go-live was a LangWatch operator's afternoon.
  #
  # THE JOURNEY, and the order is the order the work happens in:
  #
  #   1. register    tell us about the identity provider (D09, shipped)
  #   2. prove       prove the domain is yours (D05, shipped)
  #   3. test        sign in through it once, and have that count
  #   4. break glass name somebody who can still get in without it
  #   5. go live     turn it on
  #
  # WHAT COUNTS AS A TEST SIGN-IN, and why there is no new verb for it. A
  # sign-in through the registered connection leaves an account behind - the
  # engine writes one when the identity provider hands back a person. That
  # account IS the evidence, so nothing records the test separately and
  # nothing can record one that did not happen: the checklist reads the
  # account store, and activation carries the same account's id onto the
  # fact the ledger keeps. A customer cannot tick this box by clicking a
  # button; they tick it by signing in.
  #
  # THE TEST WORKS BEFORE ROUTING DOES. Whether an organization's sign-ins
  # are DECIDED by its connection is the `sso_connection_routing` flag,
  # default off. The test sign-in does not go through that decision - it
  # names the connection outright - which is what makes it possible to prove
  # the connection before anything about anybody's sign-in changes.
  #
  # THE THREE PRECONDITIONS ARE THE GUARD'S, NOT THE SCREEN'S. The aggregate
  # has always refused an activation without a proved domain, a recorded
  # test login and a live break-glass binding. What this adds is a refusal
  # per precondition, so a customer is told WHICH of the three is missing
  # and offered the thing that fixes it, instead of being told the
  # connection "isn't ready".
  #
  # BREAK GLASS IS NEVER PLAN-GATED. Registering an identity provider takes
  # an Enterprise plan and going live takes one too. Granting and renewing a
  # way back in take neither, deliberately: a lapsed subscription must never
  # be the reason an organization cannot reach its own recovery path.
  #
  # SUSPENDING STAYS OURS. A customer turns their connection on and never
  # off - the lever for a connection that is actively hurting people is a
  # LangWatch operator's, taken by a human in the moment it matters, and
  # putting it on the customer's own settings screen would put it behind the
  # identity provider that is failing.

  Background:
    Given an organization on an Enterprise plan whose administrator holds
    "sso:manage"
    And the organization is allowed to set single sign-on up itself
    And it has registered an identity provider

  # ---------------------------------------------------------------------
  # Proving the connection carries a person
  # ---------------------------------------------------------------------

  @unit
  Scenario: A sign-in through the connection is what records the test
    Given the administrator has signed in once through the registered
    connection
    When the setup screen is read
    Then the test sign-in step is done
    And the account that sign-in left behind is what it is done by

  @unit
  Scenario: No sign-in through the connection means no test
    Given nobody has signed in through the registered connection
    When the setup screen is read
    Then the test sign-in step is not done

  @unit
  Scenario: Somebody else's sign-in through another organization's connection is not this test
    Given an account exists for a different organization's connection
    When the setup screen is read
    Then the test sign-in step is not done

  @unit
  Scenario: The test sign-in names the connection rather than waiting for routing
    Given sign-in routing is not switched on for the organization
    When the administrator starts a test sign-in
    Then it is sent to the connection this organization registered
    And nothing about anybody else's sign-in changes

  @integration
  Scenario: The test sign-in is offered on the setup screen once a provider is registered
    When the administrator opens single sign-on setup
    Then they are offered a test sign-in
    And it says what it will do: sign them in through their own identity
    provider

  # TESTING AS SOMEBODY WHO IS NOT YOU is the test that proves the connection:
  # signing in as the administrator who registered it exercises a path most of
  # the organization will never take. The obvious offer — a copy of the SIGN-IN
  # link, pressed in another browser profile — cannot work, and it is written
  # down here so nobody builds it again. Starting a sign-in mints a state and
  # puts a signed copy of it in a cookie on the browser that asked; the
  # callback refuses when the two disagree, which is what stops somebody being
  # walked through a sign-in they did not begin. A copied authorization URL
  # carries the state and leaves the cookie behind. Switching that check off to
  # save a step would weaken every sign-in on the installation.

  @integration
  Scenario: Testing from another browser copies the page, never the sign-in
    When the administrator asks to test from another browser
    Then they are given a link to the page they are on
    And they are told to press the test there, because a sign-in has to start
    in the browser that finishes it

  # ---------------------------------------------------------------------
  # A way back in
  # ---------------------------------------------------------------------

  @integration
  Scenario: The ways back in are listed with who holds them and until when
    Given somebody holds a way back in that has not expired
    When the administrator opens single sign-on setup
    Then that person is named
    And the date it ends is shown

  @integration
  Scenario: Granting a way back in names a person and a date
    When the administrator grants a way back in to another administrator
    Then that person can sign in with a password even after single sign-on
    is on
    And the grant ends on the date that was chosen

  @integration
  Scenario: A way back in can be extended before it ends
    Given somebody holds a way back in that ends soon
    When the administrator renews it
    Then the new end date is shown
    And the date it previously ended is still readable

  @unit
  Scenario: A way back in can be ended on purpose
    Given somebody holds a way back in
    When the administrator ends it
    Then it stops being a way in immediately
    And the grant, its end and who ended it are still readable afterwards

  @unit
  Scenario: The last way back in cannot be ended while the connection decides sign-in
    Given the connection is ACTIVE and exactly one person holds a way back in
    When the administrator tries to end that grant
    Then it is refused with the code "sso_break_glass_last_way_in"
    And the refusal says to grant somebody else a way in first, or remove the connection itself

  @integration
  Scenario: A way back in is not offered in our words
    When the administrator opens single sign-on setup
    Then the way back in is described as somebody who can still sign in with
    a password if the identity provider stops working
    And no scenario, protocol or component of ours is named

  @integration
  Scenario: A lapsed subscription does not take the way back in away
    Given the organization is no longer on an Enterprise plan
    When the administrator grants a way back in
    Then the grant is accepted

  @integration
  Scenario: A reader who may not manage single sign-on is offered no grant
    Given the administrator may see single sign-on but not change it
    When they open single sign-on setup
    Then the ways back in are listed
    And no control that would grant or renew one is offered

  # ---------------------------------------------------------------------
  # Going live
  # ---------------------------------------------------------------------

  @unit
  Scenario: Going live with all three preconditions met turns the connection on
    Given a domain of the organization's is proved
    And the administrator has signed in once through the connection
    And somebody holds a way back in
    When the administrator goes live
    Then the connection is ACTIVE
    And the account the test sign-in left behind is recorded on the
    activation

  @unit
  Scenario: Going live without a proved domain says so by name
    Given no domain of the organization's is proved
    When the administrator goes live
    Then it is refused with "sso_activation_domain_unproved"
    And the connection is not ACTIVE

  @unit
  Scenario: Going live without a test sign-in says so by name
    Given a domain of the organization's is proved
    And nobody has signed in through the connection
    When the administrator goes live
    Then it is refused with "sso_activation_test_sign_in_missing"
    And the connection is not ACTIVE

  @unit
  Scenario: Going live without a way back in says so by name
    Given a domain of the organization's is proved
    And the administrator has signed in once through the connection
    And nobody holds a way back in
    When the administrator goes live
    Then it is refused with "sso_activation_break_glass_missing"
    And the connection is not ACTIVE

  @unit
  Scenario: A way back in that has expired is not one
    Given a domain of the organization's is proved
    And the administrator has signed in once through the connection
    And the only way back in expired yesterday
    When the administrator goes live
    Then it is refused with "sso_activation_break_glass_missing"

  @integration
  Scenario: Going live needs an Enterprise plan
    Given the organization is not on an Enterprise plan
    When the administrator goes live
    Then the request is refused with "enterprise_plan_required"

  @unit
  Scenario: Going live is refused for an organization that may not set single sign-on up
    Given the organization is not allowed to set single sign-on up itself
    When the administrator goes live
    Then it is refused with "sso_self_serve_unavailable"

  @unit
  Scenario: Going live twice costs nothing and states nothing
    Given the connection is already ACTIVE
    When the administrator goes live again
    Then no fact is stated

  # ---------------------------------------------------------------------
  # The checklist
  # ---------------------------------------------------------------------

  @integration
  Scenario: The go-live step shows all three preconditions rather than the first missing one
    Given no domain of the organization's is proved
    And nobody has signed in through the connection
    And nobody holds a way back in
    When the administrator opens single sign-on setup
    Then all three preconditions are shown as outstanding
    And each one offers the thing that would meet it

  @integration
  Scenario: The go-live button is offered only once every precondition is met
    Given a domain of the organization's is proved
    And the administrator has signed in once through the connection
    And somebody holds a way back in
    When the administrator opens single sign-on setup
    Then they are offered a go-live control

  @integration
  Scenario: A connection that is live but not routing says so plainly
    Given the connection is ACTIVE
    And sign-in routing is not switched on for the organization
    When the administrator opens single sign-on setup
    Then it says the connection is on
    And it says sign-in is not being decided by it yet

  @integration
  Scenario: A connection that is live and routing says that instead
    Given the connection is ACTIVE
    And sign-in routing is switched on for the organization
    When the administrator opens single sign-on setup
    Then it says people in the proved domains now sign in through the
    identity provider

  @integration
  Scenario: A step that cannot be read says so rather than looking finished
    Given the setup cannot be read
    When the administrator opens single sign-on setup
    Then an error is shown in the words registered for its code
    And no step is shown as done

  # ---------------------------------------------------------------------
  # What the customer surface never grows
  # ---------------------------------------------------------------------

  @unit
  Scenario: Suspending a connection is not on the customer's surface
    When the self-serve single sign-on surface is enumerated
    Then it offers no way to suspend a connection
    And it offers no way to resume one

  @unit
  Scenario: Every change the customer makes is recorded before it is attempted
    When the administrator goes live
    Then the attempt is recorded with who made it, whatever the outcome
