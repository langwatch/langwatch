Feature: A failed sign-in says what went wrong
  As someone who cannot get into LangWatch
  I want the screen to tell me why
  So that I can fix it instead of guessing

  # The sign-in and sign-up screens used to replace every failure with the same
  # sentence, so a wrong password, a rate limit and a misconfigured installation
  # all looked identical. The reason exists, it was simply discarded on the way
  # to the screen.

  Background:
    Given I am on the sign-in screen of a credentials installation

  Scenario: A wrong password says the password is wrong
    When I sign in with an email that exists and the wrong password
    Then the screen tells me the email or password is wrong
    And the message stays on screen next to the form

  Scenario: Too many attempts says to wait
    When I have tried to sign in more times than allowed
    Then the screen tells me to wait before trying again

  # The refusal itself is a configuration mismatch between the address the
  # installation is set up for and the address the browser is on. The reader is
  # not expected to know that phrase, so the screen names the thing they can
  # check: the address they are using.
  Scenario: An address mismatch says which thing to check
    When the installation refuses the sign-in because it is set up for another address
    Then the screen tells me LangWatch is set up for a different address
    And the message never shows an internal error code

  Scenario: An unexpected failure still says something honest
    When the sign-in fails for a reason the screen has no wording for
    Then the screen tells me the sign-in did not go through
    And the message never shows an internal error code

  Scenario: Sign-up failures read the same way
    Given I am on the sign-up screen
    When creating my account fails
    Then the screen tells me what went wrong rather than a fixed sentence

  # The person reading the screen gets plain wording; whoever is on the other
  # side of the installation needs the specific cause, so it goes to the log.
  Scenario: The refused address is recorded for whoever runs the installation
    When the installation refuses a sign-in because it is set up for another address
    Then the log records the address it expected and the address it received
