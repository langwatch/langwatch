Feature: Hosted runner jobs reach apt only through Ubuntu's own archives
  As a developer waiting on CI
  I want a broken third-party apt repository on the runner image to be switched off
  So that apt-get update and Playwright's system install do not fail runs that never changed

  # The ubuntu-26.04 image ships an apt source for packages.microsoft.com that answers 403
  # and is "no longer signed", so every apt-get update on it fails, retries included.

  @unit
  Scenario: Only Ubuntu's own apt sources stay enabled
    Given the runner's apt source directory holds Ubuntu archives and third-party repositories
    When the apt-ubuntu-sources action runs
    Then every one-line and deb822 source that names a host outside ubuntu.com is moved out of apt's reach
    And the log names each disabled source and its hosts
    And the Ubuntu sources, and hosts only in comments, are left alone

  @unit
  Scenario: Every apt use runs after the shared action
    Given a workflow job or a local action runs apt-get, installs Playwright with --with-deps, caches the Playwright browser,
      runs run-package-suites.ts, or runs a package script whose command installs Playwright with --with-deps
    Then an earlier step in it uses the apt-ubuntu-sources action