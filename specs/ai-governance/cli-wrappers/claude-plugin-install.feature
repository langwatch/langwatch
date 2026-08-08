# The LangWatch Claude Code plugin, installed and removed by the CLI
#
# Implementation:
#   sdks/typescript/src/cli/utils/governance/claude-plugin.ts           (state, install, uninstall)
#   sdks/typescript/src/cli/utils/governance/shell-rc.ts                (the consent and re-assert paths)
#   sdks/typescript/src/cli/commands/ingestion/install.ts               (`langwatch ingest install claude_code`)
#   sdks/typescript/src/cli/utils/governance/telemetry-targets.ts       (logout removal)
#   sdks/typescript/src/cli/utils/governance/session-context-hooks.ts   (the raw hook entries, now the fallback)
#   plugins/langwatch                                                   (the plugin itself, published from langwatch/agent-plugin)
#
# Related specs:
#   specs/ai-governance/cli-wrappers/session-context-hook.feature , what the session context hook reports
#   specs/ai-governance/cli-wrappers/logout.feature , the full teardown this plugs into
#
# Motivation: the CLI used to write raw SessionStart and Stop entries into
# `~/.claude/settings.json`, each running `langwatch ingest hook claude-code`.
# Two things are wrong with that. The entries are invisible: nothing in Claude
# Code presents them as a LangWatch feature, so a user who inherits the machine
# finds an unexplained command wired into every session. And they are version
# coupled: the entry names a subcommand of whatever `langwatch` happens to be on
# PATH, so a globally installed CLI older than the subcommand answers every
# session stop with `error: unknown command 'hook'`.
#
# A Claude Code plugin has neither problem. It is listed by name, its hooks ship
# inside it, and it is versioned and updated on its own. So consent now installs
# the plugin, and the raw entries stay only as the fallback for a `claude` too
# old to take one.
#
# The telemetry env block stays with the CLI either way: Claude Code reads its
# OTLP exporter configuration from `~/.claude/settings.json` and from nowhere
# else, and a plugin cannot set a session's environment.

Feature: The LangWatch Claude Code plugin

Rule: Consent installs the plugin, and the plugin replaces the raw hook entries

  @unit
  Scenario: Saying yes installs the marketplace and the plugin at user scope
    Given a claude binary that supports plugins
    When the user consents to capture for claude
    Then the LangWatch marketplace is registered
    And the LangWatch plugin is installed at user scope

  @unit
  Scenario: Installing the plugin removes the raw hook entries it replaces
    Given a settings file carrying the raw LangWatch hook entries
    And a claude binary that supports plugins
    When the user consents to capture for claude
    Then the raw LangWatch hook entries are gone
    And the user's own hook entries remain

  @unit
  Scenario: A marketplace that is already registered survives a failing add
    Given a claude binary whose marketplace add reports failure
    And a marketplace registration that is already on disk
    When the user consents to capture for claude
    Then the plugin install still runs
    And the plugin is reported as installed

  @unit
  Scenario: The consent prompt names the plugin and what its hooks record
    Given a wrapped claude session offering to persist capture
    When the prompt is shown
    Then it names the LangWatch Claude Code plugin
    And it says the session hooks record the repository and branch

Rule: The raw hook entries stay as the fallback for a claude that cannot take a plugin

  @unit
  Scenario: A claude without plugin support falls back to the raw hook entries
    Given a claude binary with no plugin subcommand
    When the user consents to capture for claude
    Then no plugin install is attempted
    And the raw LangWatch hook entries are written

  @unit
  Scenario: A failed plugin install falls back to the raw hook entries
    Given a claude binary whose plugin install fails
    When the user consents to capture for claude
    Then the raw LangWatch hook entries are written

  @unit
  Scenario: A failed plugin install never fails the session it was offered in
    Given a claude binary whose plugin install throws
    When the user consents to capture for claude
    Then the consent flow completes without an error
    And the telemetry env block is still persisted

  @unit
  Scenario: A failed plugin install is not retried for a day
    Given a plugin install that failed an hour ago
    When the user consents to capture for claude again
    Then no plugin install is attempted
    And the raw LangWatch hook entries are written

  @unit
  Scenario: A day after a failed install the plugin is attempted again
    Given a plugin install that failed two days ago
    When the user consents to capture for claude again
    Then the plugin install is attempted

  @unit
  Scenario: A clock that disagrees with the last failure does not block the retry
    Given a machine whose clock disagrees with the last recorded install failure
    When the user consents to capture for claude again
    Then the plugin install is attempted

Rule: Re-asserting a device's wiring costs no network and no subprocess

  @unit
  Scenario: The silent re-assert installs nothing when the plugin is already there
    Given a device whose telemetry env block is already current
    And the LangWatch plugin already installed
    When the wrapper re-asserts that device's wiring
    Then no claude subprocess runs
    And no raw LangWatch hook entries are written

  @unit
  Scenario: The silent re-assert removes raw hook entries the plugin replaced
    Given a device carrying both the LangWatch plugin and the raw hook entries
    When the wrapper re-asserts that device's wiring
    Then the raw LangWatch hook entries are gone
    And no claude subprocess runs

  @unit
  Scenario: A login refresh does not put the raw hook entries back on a plugin device
    Given a device carrying the LangWatch plugin
    When a fresh login re-syncs that device's telemetry env block
    Then the raw LangWatch hook entries are not written back
    And the env block is refreshed to the new login

  @unit
  Scenario: The silent re-assert falls back to the raw hooks without the plugin
    Given a device whose telemetry env block is already current
    And no LangWatch plugin installed
    When the wrapper re-asserts that device's wiring
    Then the raw LangWatch hook entries are written
    And no claude subprocess runs

Rule: Activating capture reports which seam it wired

  @unit
  Scenario: The claude_code install reports the plugin action
    Given a claude binary that supports plugins
    When the claude_code ingestion install runs
    Then the report says the plugin was installed
    And it reports no session hooks

  @unit
  Scenario: The claude_code install reports the raw hooks when it fell back
    Given a claude binary with no plugin subcommand
    When the claude_code ingestion install runs
    Then the report says the plugin was unavailable
    And it reports the session hooks it wrote

Rule: Logout removes the plugin and the marketplace LangWatch registered

  @unit
  Scenario: Logout lists the installed plugin and the LangWatch marketplace
    Given the LangWatch plugin installed from the LangWatch marketplace
    When logout scans for telemetry targets
    Then both the plugin and the marketplace are listed

  @unit
  Scenario: Logout uninstalls the plugin and removes the marketplace
    Given the LangWatch plugin installed from the LangWatch marketplace
    When logout removes the telemetry targets
    Then the plugin is uninstalled at user scope
    And the marketplace registration is removed

  @unit
  Scenario: A plugin the uninstall subcommand cannot remove is disabled instead
    Given a claude binary whose plugin uninstall fails
    And the LangWatch plugin enabled in the settings file
    When logout removes the telemetry targets
    Then the plugin is disabled in the settings file
    And the user's other settings are preserved

  @unit
  Scenario: A second logout leaves capture off rather than reporting a failure
    Given capture an earlier logout already switched off
    And a claude that cannot uninstall the plugin
    When logout removes the telemetry targets
    Then logout reports the plugin removed

  @unit
  Scenario: A marketplace LangWatch did not register is left alone
    Given a marketplace of the same name pointing at somebody else's repository
    When logout scans for telemetry targets
    Then the marketplace is not listed
    And removing it runs no claude subprocess

Rule: Plugin state is read defensively

  @unit
  Scenario: Unreadable plugin state reads as nothing installed
    Given plugin state files that are missing or hold malformed JSON
    When the plugin state is read
    Then nothing is reported as installed and nothing is thrown

  @unit
  Scenario: A marketplace that only mentions our repository is not ours
    Given a marketplace of the same name published by somebody else, whose
      notes mention our repository
    When the plugin state is read
    Then the marketplace is not claimed as ours
