# Keeping the installed LangWatch plugin current
#
# Implementation:
#   sdks/typescript/src/cli/utils/governance/claude-plugin.ts   (the version check and the update)
#   sdks/typescript/src/cli/utils/governance/wrapper.ts         (the wrapped-run seam that calls it)
#   sdks/typescript/src/cli/utils/compare-versions.ts           (the version comparison)
#
# Related specs:
#   specs/ai-governance/cli-wrappers/claude-plugin-install.feature , how the plugin gets there
#   specs/ai-governance/cli-wrappers/session-context-hook.feature , what its hooks report
#
# Motivation: the plugin carries the hook script, so the code that records a
# session's repository and branch now ships inside a versioned artifact rather
# than resolving against whatever `langwatch` is on PATH. That solves the drift
# it was built to solve only while the installed copy keeps up with what we
# publish, and Claude Code will not do that on its own: it auto-updates its own
# marketplaces by default and leaves third-party ones like ours switched off, so
# a plugin installed once stays at that version forever unless somebody finds
# the toggle.
#
# The wrapper is the natural place to fix that. It already runs before every
# `langwatch <tool>` launch, it already re-syncs the telemetry wiring there, and
# an update applied before the spawn is picked up by the session about to start
# rather than the one after it.
#
# Two properties this must keep. It cannot become a tax on startup, so the check
# is stamped and runs at most once a day; every run in between reads one config
# field and stops. And it cannot fail a launch, because a coding session the
# user asked for must not depend on our housekeeping: a `claude` that cannot be
# reached, a marketplace that will not refresh and an update that will not apply
# all warn and get out of the way.

Feature: Keeping the LangWatch Claude Code plugin up to date

Rule: A wrapped run brings the installed plugin up to the published version

  @unit
  Scenario: A plugin the marketplace has moved past is updated before the tool starts
    Given the LangWatch plugin is installed at an older version than the marketplace publishes
    When the user runs a wrapped tool
    Then the marketplace listing is refreshed
    And the plugin is updated
    And the user is told which version it moved to

  @unit
  Scenario: A plugin already at the published version is left alone
    Given the LangWatch plugin is installed at the version the marketplace publishes
    When the user runs a wrapped tool
    Then the plugin is not updated
    And nothing is reported to the user

  @unit
  Scenario: The plugin is kept current from a machine that wraps another tool
    Given the LangWatch plugin is installed at an older version than the marketplace publishes
    And a machine whose only wrapped tool is codex
    When the user runs a wrapped tool
    Then the plugin is updated

  @unit
  Scenario: A marketplace of our name that somebody else registered is left alone
    Given a marketplace named langwatch that points at another repository
    And the LangWatch plugin is installed
    When the user runs a wrapped tool
    Then the plugin is not updated

Rule: A check that has nothing to do costs nothing

  @unit
  Scenario: A machine without the plugin is not asked about it
    Given the LangWatch plugin is not installed
    When the user runs a wrapped tool
    Then no claude subprocess runs

  @unit
  Scenario: A plugin checked today is not checked again
    Given the plugin was checked for updates an hour ago
    When the user runs a wrapped tool
    Then no claude subprocess runs

  @unit
  Scenario: A day after the last check the plugin is checked again
    Given the plugin was checked for updates two days ago
    When the user runs a wrapped tool
    Then the marketplace listing is refreshed

  @unit
  Scenario: A check stamped in the future does not suppress the next one
    Given the plugin was checked for updates at a time in the future
    When the user runs a wrapped tool
    Then the marketplace listing is refreshed

  @unit
  Scenario: A claude that cannot manage plugins is left alone
    Given a claude binary with no plugin subcommand
    And the LangWatch plugin is installed at an older version than the marketplace publishes
    When the user runs a wrapped tool
    Then the plugin is not updated

  @unit
  Scenario: A config that cannot be read stops the check rather than repeating it
    Given a CLI config file that cannot be parsed
    And the LangWatch plugin is installed
    When the user runs a wrapped tool
    Then no claude subprocess runs

Rule: Nothing here may stop the session the user asked for

  @unit
  Scenario: A run that waits on the network says what it is waiting for
    Given the LangWatch plugin is installed at an older version than the marketplace publishes
    When the user runs a wrapped tool
    Then the user is told the check is running before it reaches the network

  @unit
  Scenario: A run that answers from disk says nothing at all
    Given the plugin was checked for updates an hour ago
    When the user runs a wrapped tool
    Then the user is told nothing about the check

  @unit
  Scenario: A marketplace listing that will not refresh warns and gives up for the day
    Given a claude binary whose marketplace update reports failure
    And the LangWatch plugin is installed at the version its stale listing publishes
    When the user runs a wrapped tool
    Then the user is warned that the plugin could not be checked
    And the check is not attempted again until tomorrow

  @unit
  Scenario: An update that will not apply warns
    Given the LangWatch plugin is installed at an older version than the marketplace publishes
    And a claude binary whose plugin update reports failure
    When the user runs a wrapped tool
    Then the user is warned that the plugin could not be updated

  @unit
  Scenario: A version that cannot be read is left alone rather than blindly updated
    Given a marketplace listing whose plugin manifest cannot be read
    And the LangWatch plugin is installed
    When the user runs a wrapped tool
    Then the plugin is not updated
