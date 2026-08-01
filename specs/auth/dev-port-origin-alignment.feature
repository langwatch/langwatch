Feature: Signing in works on whatever port the app is actually served on
  As a developer running several LangWatch checkouts side by side
  I want sign-in to work on the port my checkout took
  So that a second checkout is not a broken checkout

  # Every state-changing call to /api/auth/* is checked against the address the
  # app is configured to live at. When the two disagree the call is refused,
  # which is correct for a cross-site request and wrong for a developer whose
  # checkout simply took a different port.
  #
  # The configured address is written twice: once by the launcher, from the port
  # it is about to bind, and once by the environment file, which is committed
  # with the default port and cannot know about the second checkout. The
  # environment file is loaded last and wins, so the launcher's value never
  # survives to the moment the check runs. That is the whole bug.

  Background:
    Given the environment file pins the app address to the default port
    And the app is started on a different port

  Scenario: Sign-in succeeds on a non-default port
    When I sign in with a valid email and password
    Then I am signed in
    And the request is not refused as coming from an unrecognised address

  Scenario: The address the app checks against follows the port it was started on
    When the app finishes loading its configuration
    Then the address it accepts sign-ins from names the port it was started on
    And the address it hands to the identity layer names the same port

  Scenario: A wrong password is still a wrong password
    When I sign in with a valid email and the wrong password
    Then I am told the email or password is wrong
    And the request is not refused as coming from an unrecognised address

  # Anything that is not a plain localhost address is a deliberate choice by
  # whoever set it: a proxy in front of a preview environment, a tunnel, a
  # hostname-routed local stack, or a real deployment. Rewriting those would
  # break exactly the setups they exist for.
  Scenario Outline: A deliberately configured address is left alone
    Given the app address is configured as "<address>"
    When the app finishes loading its configuration
    Then the address it accepts sign-ins from is still "<address>"

    Examples:
      | address                                     |
      | https://preview.example.com                 |
      | http://127.0.0.1:5560                       |
      | https://app.mystack.langwatch.localhost     |

  Scenario: A real deployment is never rewritten
    Given the app is running as a deployed installation
    And the app address is configured as "https://app.langwatch.ai"
    When the app finishes loading its configuration
    Then the address it accepts sign-ins from is still "https://app.langwatch.ai"

  # The launcher also derives other addresses from the port, and those may be
  # overridden from the environment file on purpose. Realigning the sign-in
  # address must not take that away.
  Scenario: Addresses deliberately pinned in the environment file still win
    Given the environment file pins the gateway address to a host outside this machine
    When the app finishes loading its configuration
    Then the gateway address is the one from the environment file
