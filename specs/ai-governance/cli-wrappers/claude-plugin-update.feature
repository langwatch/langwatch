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
# Two properties this must keep. It cannot become a tax on startup, so it looks
# at most once a day and every launch in between starts the tool immediately.
# And it cannot cost anyone the session they asked for, so every way it can go
# wrong ends with the tool starting anyway.

Feature: Keeping the LangWatch Claude Code plugin up to date

Rule: A wrapped run brings the installed plugin up to the published version

  @unit
  Scenario: A plugin the marketplace has moved past is brought up to date
    Given the LangWatch plugin is installed at an older version than the marketplace publishes
    When the user runs a wrapped tool
    Then the plugin on the machine is the version the marketplace publishes
    And the user is told which version it moved to

  @unit
  Scenario: A plugin already at the published version is left alone
    Given the LangWatch plugin is installed at the version the marketplace publishes
    When the user runs a wrapped tool
    Then the plugin on the machine is left as it is
    And the user is told nothing about the plugin

  @unit
  Scenario: The plugin is kept current from a machine that wraps another tool
    Given the LangWatch plugin is installed at an older version than the marketplace publishes
    And a machine whose only wrapped tool is codex
    When the user runs a wrapped tool
    Then the plugin on the machine is the version the marketplace publishes

Rule: A launch with nothing to keep current starts the tool immediately

  @unit
  Scenario: A machine without the plugin is not held up by it
    Given the LangWatch plugin is not installed
    When the user runs a wrapped tool
    Then the tool starts without looking for a plugin update

  @unit
  Scenario: A plugin somebody installed for one repository only is not touched
    Given the LangWatch plugin is installed for a single repository rather than for the user
    When the user runs a wrapped tool
    Then the tool starts without looking for a plugin update

  @unit
  Scenario: A plugin looked at today is not looked at again
    Given the plugin was checked for updates an hour ago
    When the user runs a wrapped tool
    Then the tool starts without looking for a plugin update
    And the user is told nothing about the plugin

  @unit
  Scenario: A day after the last check the plugin is looked at again
    Given the plugin was checked for updates two days ago
    And the LangWatch plugin is installed at an older version than the marketplace publishes
    When the user runs a wrapped tool
    Then the plugin on the machine is the version the marketplace publishes

  @unit
  Scenario: A check stamped in the future does not suppress the next one
    Given the plugin was checked for updates at a time in the future
    And the LangWatch plugin is installed at an older version than the marketplace publishes
    When the user runs a wrapped tool
    Then the plugin on the machine is the version the marketplace publishes

  @unit
  Scenario: A machine that cannot remember the check does not repeat it every launch
    Given a machine whose LangWatch settings cannot be saved
    And the LangWatch plugin is installed at an older version than the marketplace publishes
    When the user runs a wrapped tool
    Then the tool starts without looking for a plugin update

Rule: Nothing here may cost the user the session they asked for

  @unit
  Scenario: A run that waits on the network says what it is waiting for
    Given the LangWatch plugin is installed at an older version than the marketplace publishes
    When the user runs a wrapped tool
    Then the user is told the plugin is being checked before the waiting starts

  @unit
  Scenario: A claude that cannot manage plugins leaves the plugin as it is
    Given a claude binary with no plugin subcommand
    And the LangWatch plugin is installed at an older version than the marketplace publishes
    When the user runs a wrapped tool
    Then the plugin on the machine is left as it is
    And the tool starts

  @unit
  Scenario: A marketplace listing that will not refresh warns and gives up for the day
    Given a claude binary whose marketplace update reports failure
    And the LangWatch plugin is installed at the version its stale listing publishes
    When the user runs a wrapped tool
    Then the user is warned that the plugin could not be checked
    And the plugin is not checked again until tomorrow

  @unit
  Scenario: An update that will not apply warns
    Given the LangWatch plugin is installed at an older version than the marketplace publishes
    And a claude binary whose plugin update reports failure
    When the user runs a wrapped tool
    Then the user is warned that the plugin could not be updated
    And the user is not told a version they do not have

  @unit
  Scenario: A version that cannot be read leaves the plugin alone rather than replacing it blindly
    Given a marketplace listing that does not say which version it publishes
    And the LangWatch plugin is installed
    When the user runs a wrapped tool
    Then the plugin on the machine is left as it is

  @unit
  Scenario: A marketplace of our name that somebody else registered is left alone
    Given a marketplace named langwatch that points at another repository
    And the LangWatch plugin is installed
    When the user runs a wrapped tool
    Then the plugin on the machine is left as it is
