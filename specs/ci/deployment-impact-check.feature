Feature: Deployment-impact check skips manifest-only dependency bumps
  As a dependency-bump author (dependabot, or a human running a routine
  version bump)
  I want a PR that only changes resolved dependency versions to merge without
  writing a deployment-impact writeup
  So that routine version bumps are not blocked by a requirement that only
  makes sense for PRs that actually touch deployed behavior

  Background:
    Given a pull request whose head repo matches the target repo
    And the branch is not a release-please branch
    And the PR touches an area the deployment-impact check normally requires
      a "## Deployment Impact" section for

  A pure lockfile (an auto-generated resolution snapshot: nothing hand-edits
  it) can't add an env var, a helm value, or change default install
  behavior — it has no deployment surface by construction, no matter who
  authored the PR. A hand-edited dependency manifest is a step down in that
  guarantee: it's still usually just a version bump, but a person editing it
  by hand could slip in something else at the same time (a new build script,
  an entrypoint change) — so that weaker exemption only holds for dependency
  bots, not humans.

  @unit
  Scenario: A dependency bot's PR touches only auto-generated lockfiles
    Given the PR is authored by a trusted dependency-update bot
    And every changed file is an auto-generated dependency lockfile
    And the PR description has no deployment-impact writeup
    Then the check passes without requiring one

  @unit
  Scenario: A dependency bot's PR touches only hand-edited dependency manifests
    Given the PR is authored by a trusted dependency-update bot
    And every changed file is a hand-edited dependency manifest, a lockfile,
      or both
    And the PR description has no deployment-impact writeup
    Then the check passes without requiring one

  @unit
  Scenario: A human's PR touches only hand-edited dependency manifests
    Given the PR is authored by a human, not a dependency-update bot
    And every changed file is a hand-edited dependency manifest
    And the PR description has no deployment-impact writeup
    Then the check still requires one, since a manifest edit could carry
      more than a version bump

  @unit
  Scenario: A PR touches a file that isn't a recognized dependency manifest
    Given at least one changed file is not a lockfile or dependency manifest
    And the PR description has no deployment-impact writeup
    Then the check still requires one, regardless of what else changed
