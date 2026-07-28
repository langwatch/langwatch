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
  Scenario: Generating a project API key does not start the first-trace watcher
    Given the CLI requested a project API key instead of a device session
    When the user generates the key
    Then the API key success card renders without any waiting status line
    And the page does not navigate away

  @bdd @cli-onboarding @first-trace @unit
  Scenario: First-trace polling only runs while the page is visible and stops at the timeout
    Given the watch confirmed the project has never synced a trace
    Then the poll interval is active only while the tab is visible
    And no polling happens after the timeout elapses
    And no polling happens once the project is known to already have traces
    And no polling happens while the redirect is underway
