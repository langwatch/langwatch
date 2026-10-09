# Why this exists, and why only one of the four cases gets the warm path.
#
# When the session gate rejects a request it sends everybody to the same cold
# sign-in screen: an empty address box, greeting a stranger. For most arrivals
# that is correct, because the browser has told us nothing. But the four ways a
# request can arrive unauthenticated are not equally ignorant:
#
#   cookie absent              -> nothing known. New person, cleared cookies,
#                                 another browser, incognito, a shared link.
#   cookie present, no row     -> the session was DELIBERATELY ended. Revoked by
#                                 an administrator, or the person signed out
#                                 everywhere because they feared a compromise.
#   cookie present, row expired-> we know exactly who, and that this browser was
#                                 signed in here. Sessions last thirty days, so
#                                 this is rare and unambiguous.
#   cookie unreadable          -> a string somebody handed us. Possibly a forgery.
#
# Only the third earns recovery. The second must NOT: the whole point of ending
# sessions everywhere is that the machine may not be the owner's, and printing
# the account's address on it would undo the thing the person just asked for.
# The fourth must not either, and must not say WHY — confirming that a token
# parsed tells a forger their forgery parsed.
#
# There is no account-enumeration surface here. The classification is computed
# from the caller's OWN cookie and takes no input, so it can only ever describe
# a session the caller already holds.

Feature: Coming back after a session expires
  As somebody whose session aged out while I was away
  I want the sign-in screen to know who I am
  So that returning is one step instead of starting over as a stranger

  Background:
    Given sessions last thirty days before they expire

  # --- The one case that earns recovery ----------------------------------

  @integration
  Scenario: An expired session is recognised and the address carried forward
    Given I signed in on this browser and my session has since expired
    When the session gate sends me to sign in
    Then the screen tells me my session expired
    And my email address is already filled in
    And I am taken straight to choosing how to prove it
    And the page I was trying to reach is still where I return to

  @integration
  Scenario: The expired notice replaces the greeting, not the error copy
    Given I arrive at sign-in with an expired session
    When the screen renders
    Then it does not greet me as a first-time visitor
    And it does not report that anything went wrong
    And it says the one thing that is true: the session ran out

  # --- The three that do not ---------------------------------------------

  # THE SECURITY ONE. Ending every session is what somebody does when they think
  # a machine is not theirs any more; the screen on that machine must not then
  # print whose account it was.
  @integration
  Scenario: A revoked session is given the cold screen and no address
    Given my session was ended deliberately rather than left to expire
    When the session gate sends me to sign in
    Then the screen does not tell me whose account it was
    And no address is filled in
    And it does not say the session expired, because it did not

  @unit
  Scenario: A request with no session cookie is treated as a stranger
    Given I arrive with no session cookie at all
    When the sign-in screen asks whether a prior session explains my arrival
    Then the answer names nobody
    And the screen is the ordinary first-time one

  # Never "your signing key changed", never "that token could not be read".
  # Telling somebody their forged cookie parsed is telling them how close they
  # got.
  @unit
  Scenario: An unreadable token reveals neither who nor why
    Given I arrive with a session cookie that matches no session we issued
    When the sign-in screen asks whether a prior session explains my arrival
    Then the answer names nobody
    And nothing on screen distinguishes this from arriving with no cookie

  @unit
  Scenario: An expired session whose account is gone names nobody
    Given I arrive with an expired session whose account has since been deleted
    When the sign-in screen asks whether a prior session explains my arrival
    Then the answer names nobody

  # --- What recovery must never become -----------------------------------

  # An expired session is a fact about the past, not a credential. It shortens
  # the walk; it never replaces a step of it.
  @integration
  Scenario: Recognition is not authentication
    Given I arrive with an expired session that we recognise
    When my address is filled in for me
    Then I still have to prove who I am before anything is shown to me
    And the expired session does not count as one of the proofs
