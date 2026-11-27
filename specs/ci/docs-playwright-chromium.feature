Feature: The docs jobs install Playwright Chromium through a stale or syncing apt mirror
  As a developer waiting on the docs checks
  I want the Chromium install to survive a stale apt index and a mirror mid-sync
  So that a security update on Ubuntu does not fail docs runs that never changed

  # The playwright-chromium action installs Chromium with --with-deps, which reads the
  # runner image's apt index. That index goes stale when Ubuntu publishes a security
  # update, and the old package version then 404s.

  @unit
  Scenario: Each attempt refreshes the apt index under a timeout before installing
    Given the playwright-chromium action runs
    When an install attempt starts
    Then it runs apt-get update under a timeout
    And it then runs the Playwright install with --with-deps under a timeout
    And that install timeout is at least the 10 minutes the ffmpeg install in docs-media-encoders gets

  @unit
  Scenario: A failed index refresh still runs the install
    Given apt-get update fails or times out
    When the install attempt continues
    Then a warning is printed
    And the Playwright install still runs on the current index, on the first attempt and on the retry

  @unit
  Scenario: A failed install is retried once after a pause
    Given the first install attempt fails
    When the action handles the failure
    Then it waits and runs one more attempt with a fresh index
    And a second failure fails the step

  @unit
  Scenario: Every use bounds the install inside its job's budget
    Given a workflow step uses the playwright-chromium action
    Then the step sets timeout-minutes that cover both attempts and the pause
    And the job's timeout-minutes is above the step's, so the step bound can fire
