Feature: Post-login first-trace watch on the CLI authorize page
  As a developer approving `langwatch login` in the browser
  I want the authorize page to notice my very first trace arriving
  So that right after my first Claude Code turn I land on my own traces
  instead of a dead-end "you can close this tab" card

  # Background
  #
  # The device-session flow ends on /cli/auth with a green success card. The
  # user's next act is running the wrapped tool in the terminal; for a brand
  # new account the wow moment is seeing that first session appear. The page
  # therefore watches Project.firstMessage on the user's personal project
  # (the project device-session traces land on) and redirects to
  # /<personal-project-slug>/traces when it flips.
  #
  # The watch is polite: it only starts when the project has never synced a
  # trace, polls on a seconds-scale interval only while the tab is visible,
  # and gives up after a timeout rather than polling forever. Users whose
  # project already has traces keep the existing close-this-tab behavior.

  Background:
    Given a signed-in user with a personal workspace
    And the user completed the device-code approval on /cli/auth

  @bdd @cli-onboarding @first-trace @integration
  Scenario: Approving a device session before any trace has synced waits and then redirects to the personal traces page
    Given the personal project has never received a trace
    When the user approves the device session
    Then the success card shows a "Waiting for your first trace" status line
    And when the personal project receives its first trace
    Then the page announces the trace arrived
    And navigates to the personal project's traces page

  @bdd @cli-onboarding @first-trace @integration
  Scenario: Approving a device session when the personal project already has traces keeps the plain success card
    Given the personal project has already received traces
    When the user approves the device session
    Then the success card renders without any waiting status line
    And the page does not navigate away

  @bdd @cli-onboarding @first-trace @integration
  Scenario: The watch follows the organization the approval was granted for
    Given the page was opened in one organization and the user approves for another
    And the approved organization's personal project has never received a trace
    When the user approves the device session
    Then the waiting status line watches the approved organization's personal project
    And the first trace there takes the user to that project's traces page

  @bdd @cli-onboarding @first-trace @integration
  Scenario: The page's organization list names who owns each personal workspace
    Given the signed-in user owns a personal workspace in an organization
    When the page reads the organizations the user belongs to
    Then that workspace's team names the user as its owner, so the watch can find it

  @bdd @cli-onboarding @first-trace @integration
  Scenario: Sending a project API key keeps the success card still, with no waiting line and no redirect
    Given the CLI requested a project API key instead of a device session
    When the user sends the key to the CLI
    Then the API key success card renders without any waiting status line
    And the page does not navigate away

  @bdd @cli-onboarding @first-trace @unit
  Scenario: First-trace reads stop at the timeout, once traces are known and during the redirect
    Given the watch confirmed the project has never synced a trace
    Then the watch reads while it is live
    And no read happens after the timeout elapses
    And no read happens once the project is known to already have traces
    And no read happens while the redirect is underway

  @bdd @cli-onboarding @first-trace @integration
  Scenario: The first-trace watch sets no timer
    Given the watch confirmed the project has never synced a trace
    Then the watch's read has no refetch interval
    And it does not refetch when the window regains focus

  @bdd @cli-onboarding @first-trace @integration
  Scenario: The watch updates when the project's first trace is received
    Given the watch confirmed the project has never synced a trace
    When the project's first trace is received
    Then the page learns of it from a server event, with no timer and without waiting for the stored flag
    And the redirect starts
    And the traces page it lands on shows the trace, not the empty state
