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
  # THE TEST WORKS BEFORE ROUTING DOES. An organization's sign-ins are
  # decided by its connection once that connection is turned on, and this
  # step comes first. The test sign-in does not go through that decision - it
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

  # A SUCCESS IS A REAL SIGN-IN, and what follows one was already handled:
  # somebody who comes back as a different person lands on a page saying the
  # test worked, naming the address the session is now held as, and offering
  # the way back to their own account. What was missing is the sentence
  # BEFORE the button. "Brings you back here" reads like a round trip that
  # returns you as yourself, so the one consequence an administrator cannot
  # undo by reading further - being signed out of the session they are
  # configuring the connection with - arrived as a surprise.

  @integration
  Scenario: The test says it will replace this session before it is pressed
    When the administrator reads the test sign-in step
    Then they are told a success signs them in for real and replaces this
    session
    And they are told they come back as whoever the provider says they are
    And they are told they will be offered the way back to their own account

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
  # Who the connection lets in
  # ---------------------------------------------------------------------

  # THE QUESTION NOBODY WAS ASKED. `allowsJit` defaulted to false and the
  # journey never mentioned it, so every connection in the database forbade
  # provisioning — and a person signing in through their own organization's
  # identity provider was authenticated and then handed a brand new workspace
  # of their own. That is the opposite of what registering a connection means,
  # and nobody chose it: it was a default nobody surfaced.
  #
  # It is asked after the domain proof, because the widest answer is "anybody
  # on a domain you proved" and that means nothing until one is. What bounds
  # that answer is ROUTING, not the setting: an address only ever reaches a
  # connection whose domain that connection proved.

  @integration
  Scenario: The journey asks who the connection lets in
    Given a connection whose domain is proved
    When the administrator reaches the step after the way back in
    Then they are offered three answers: the arrivals join, they wait for
    approval, or they are turned away
    And the widest answer says it rests on the domain proof

  @integration @regression
  Scenario: A claimed connection cannot confirm arrivals before its domain is verified
    Given a connection whose domain claim is awaiting proof
    When the administrator opens who it lets in
    Then the arrival choices are disabled
    And they are told to verify a domain before configuring who can join

  @unit
  Scenario: Saying nothing is not an answer, and going live says so
    Given every other precondition is met and nobody has said who it admits
    When the administrator turns the connection on
    Then it is refused with code sso_activation_arrivals_undecided
    And the connection is not on

  @integration @regression
  Scenario: The initial arrival choice can be confirmed without changing the default
    Given every other precondition is met and nobody has said who it admits
    And "Only people already here" is selected on the setup screen
    When the administrator confirms that choice without changing the selection
    Then the displayed choice is submitted for the current connection
    And going live stays unavailable until the saved decision is read back
    And confirming the choice does not turn the connection on

  @integration
  Scenario: Only administrators can confirm the initial arrival choice
    Given nobody has said who the connection admits
    When a reader without permission to manage single sign-on opens setup
    Then they can read the selected policy
    But they cannot change or confirm it

  @unit
  Scenario: Any of the three answers unblocks it, because the gate is deciding
    Given every other precondition is met
    When the administrator says the connection turns arrivals away
    Then turning it on is no longer refused
    And arrivals are turned away

  @unit
  Scenario: A connection registered before the question keeps what it did
    Given a connection whose history carries no answer
    When anything asks who it admits
    Then it answers with what allowsJit already said
    And nothing about its behaviour changed

  @unit
  Scenario: Saying it out loud is a fact even where the behaviour is the same
    Given a connection nobody has answered for, which turns arrivals away
    When the administrator chooses to turn arrivals away
    Then the decision is recorded
    And it is no longer waiting to be decided

  # TWICE NOW a verb was added to the ledger without a carrier on the queue,
  # and the customer's save 500'd as an unknown error. The two lists live in
  # two files on purpose (the ledger must not import the pipeline), so the
  # agreement is pinned by a test instead of a type.
  @unit
  Scenario: Every verb the ledger can stage is one the pipeline will carry
    Given the list of commands the connection ledger stages by name
    Then the pipeline declares a sender for every one of them
    And declares no sender the ledger cannot reach

  # The same defect from the other side: the projection subscribes to a LIST
  # of events, and an event in the wire union but not in the list is stored
  # and never folded — the save succeeds, the read never changes, and no
  # error is raised anywhere. Five events sat in that gap, the arrivals
  # answer among them.
  @unit
  Scenario: Every fact the aggregate can state is one the projection folds
    Given the wire union of connection events
    Then the operational projection subscribes to every member
    And subscribes to nothing outside the union

  # The answers are three and the provisioning question is two: an arrival is
  # provisioned unless the answer is that nobody new gets in. Asking for
  # approval provisions too, because the request an administrator answers has
  # to be ABOUT somebody. The fold read this as "only admit provisions", so
  # the middle answer routed sign-ins and then dropped every arrival.
  @unit
  Scenario: Each answer says whether an arrival is provisioned
    Given the three answers a connection can give about who it admits
    Then joining automatically and asking for approval both provision the
    arrival
    And only refusing provisions nobody

  @unit
  Scenario: An arrival on a connection that asks keeps the account and waits
    Given a connection whose answer is that arrivals wait for approval
    When somebody it has never seen signs in through it
    Then they keep the account the sign-in created
    But they are not a member until an administrator answers

  # ---------------------------------------------------------------------
  # Where the test sign-in leaves you
  # ---------------------------------------------------------------------

  # THE ONE ARRIVAL THAT IS ALWAYS EARLY. Going live needs a test sign-in, and
  # a test sign-in happens while the connection is still VERIFIED - so the
  # arrival gate, which admits nobody before ACTIVE, drops it every time. The
  # tester is left authenticated, holding no membership, and the orgless
  # landing sends them to the screen that creates an organization: the "handed
  # a brand new workspace of their own" outcome the decided-arrivals
  # precondition exists to prevent, reached by the one sign-in the checklist
  # itself demands.
  #
  # The arrival rule is unchanged - nobody is provisioned before the
  # connection is live. What changes is that the product stops treating the
  # tester as a fresh signup. The connection they came through is named by the
  # account the sign-in left behind, and a connection that is not live is the
  # whole of the evidence. Nothing travels back from the provider to say so:
  # a query parameter the browser sets is not evidence, because the browser
  # is who we would be asking.

  @unit
  Scenario: A sign-in through a connection that is not live yet is a test arrival
    Given somebody holds an account through a connection that is not live
    When the server is asked where they stand
    Then they are answered as somebody testing a connection
    And the connection and the organization it belongs to are named

  @unit
  Scenario: A sign-in through a live connection is not a test arrival
    Given somebody holds an account through a connection that is live
    When the server is asked where they stand
    Then they are not answered as somebody testing a connection

  # NOT LIVE IS NOT THE SAME AS BEING SET UP. A discarded, rejected,
  # suspended or torn-down connection is every bit as much "not ACTIVE" as one
  # half-way through its ceremonies, and somebody holding an account through
  # one of those has no setup to go back and finish. Answering for them would
  # tell them to complete something that no longer exists and refuse them an
  # organization for good, which is a worse dead end than the one this
  # replaced.

  @unit
  Scenario: A connection that was abandoned strands nobody
    Given somebody holds an account through a connection that was discarded
    When the server is asked where they stand
    Then they are not answered as somebody testing a connection
    And the ordinary way out of belonging to no organization is still open

  @unit
  Scenario: The browser's own say-so is not what decides it
    Given somebody holds no account through any connection
    When their browser claims the sign-in was a test
    Then they are not answered as somebody testing a connection

  @unit
  Scenario: A test arrival is not sent to the screen that creates an organization
    Given somebody belongs to no organization
    When they arrived through a connection that is not live
    Then they are sent to what happened to their test sign-in
    But somebody who simply has no organization yet still reaches the screen
    that creates one

  @unit
  Scenario: Nobody is sent anywhere while the question is still out
    Given somebody belongs to no organization
    When it is not known yet whether they arrived through a connection
    Then they are sent nowhere until it is

  @integration
  Scenario: A test arrival is told the test worked and offered the way back
    Given an administrator has signed in through a connection that is not live
    When they land on what happened
    Then they are told the test sign-in worked
    And they are told which address the session is now held as
    And they are offered the way back to their own account

  @unit
  Scenario: A test arrival cannot create an organization
    Given somebody signed in through a connection that is not live yet
    When they ask to create an organization
    Then it is refused with code sso_test_arrival_cannot_create_organization
    And no organization is created

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

  # ── A way back in that can actually be walked ──────────────────────────

  # Everything above promises that the person holding a grant "can sign in
  # with a password even after single sign-on is on". Three things have to be
  # true for that promise to hold, and each was once assumed rather than
  # checked:
  #
  #   1. the deployment MOUNTS a password door at all. On cloud it does not
  #      unless the instance is natively in email mode, so an organization
  #      brokered through another provider has no local door behind the
  #      promise.
  #   2. the check that guards this reads the deployment's RESOLVED method
  #      policy, rather than a hardcoded list that is never empty and so
  #      answered "there is a door" everywhere.
  #   3. the named person HOLDS a password. Anybody who has only ever signed
  #      in through the brokered provider holds none, which is every
  #      administrator of an organization moving off one.
  #
  # The module that implements the check already stated the standard it did
  # not reach: "somebody could sign in with a password if they had one" is
  # not the same as "this person can get in on Monday". These scenarios are
  # that standard, and the product now meets it — the method policy answers
  # whether a door is hung, the grant refuses a holder with no key, and the
  # migration counts only the ways back in somebody could walk.

  @unit
  Scenario: A deployment that mounts no password door cannot promise a way back in
    Given an installation where signing in with a password is not offered at all
    When the administrator tries to turn the connection on
    Then it is refused with "sso_activation_break_glass_missing"
    And the refusal says the deployment has no password door for a grant to be a way in through

  @unit
  Scenario: A way back in names somebody who holds a password, not merely somebody senior
    Given an administrator who has only ever signed in through the identity provider
    When the administrator grants them a way back in
    Then it is refused, because they hold no password to come back in with
    And the refusal says they must set one first

  @unit
  Scenario: The people offered a way back in are the ones who could use it
    Given some administrators hold a password and others have only ever used the identity provider
    When the administrator opens the list of people to grant a way back in to
    Then only the ones holding a password are offered
    And the others are shown with what they would have to do first

  # Setting a first password needs a live session, so the ask has to land
  # while the provider being replaced still works. The migration screen is
  # where it lands, which is why the blocker carries the remedy rather than
  # only the complaint.
  @unit
  Scenario: The ask to set a password lands while the old provider can still sign somebody in
    Given an organization whose administrators have only ever signed in through the provider being replaced
    When the migration is checked for what is blocking it
    Then the blocker says the way back in needs somebody who has set a password
    And it says a password can only be set while somebody is still signed in

  @unit
  Scenario: Finalizing counts the ways back in that can actually be walked
    Given the only unexpired grant belongs to somebody who holds no password
    When the migration is checked for what is blocking it
    Then "recovery-path-missing" is among the blockers
    And a grant nobody can use does not satisfy the requirement to keep one live way back in

  # ---------------------------------------------------------------------
  # Going live
  # ---------------------------------------------------------------------

  # THE SECOND HALF OF THE ERRAND IS ON ANOTHER PAGE, reading another query.
  # Going live is what makes a connection able to carry a provisioning token,
  # and the dialog that issues one decides what to offer from a read this
  # screen never touched — so the connection just turned on was still
  # remembered as not live, and the dialog said so, with a page reload as the
  # only way forward.

  @integration
  Scenario: A connection just turned on can carry a provisioning token without a reload
    Given an administrator has turned their connection on
    When they go on to set up provisioning
    Then the connection is offered as one that can carry a token
    And they do not have to reload the page first

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
  Scenario: A connection that is live says sign-in is decided by it
    Given the connection is ACTIVE
    When the administrator opens single sign-on setup
    Then it says the connection is on
    And it says people in the proved domains now sign in through the
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

  @integration @regression
  Scenario: An accepted activation refreshes until the connection is shown as active
    Given the activation command succeeds before the setup projection catches up
    When the administrator turns on the ready connection
    Then the page says activation was accepted and its status is updating
    And activation remains unavailable while the page reads the setup again
    And the live connection appears without a reload or another activation
    And setup polling stops when the connection is shown as active
