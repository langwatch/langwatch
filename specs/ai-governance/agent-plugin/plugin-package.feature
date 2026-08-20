# The LangWatch agent plugin: one directory, installable by two worlds
#
# Implementation:
#   plugins/langwatch/plugin.json                      (the portable Agent Plugins 1.0 manifest)
#   plugins/langwatch/.claude-plugin/plugin.json       (the Claude Code manifest)
#   plugins/langwatch/.claude-plugin/marketplace.json  (the marketplace that offers it)
#   plugins/langwatch/hooks/hooks.json                 (the Claude Code session hooks)
#   plugins/langwatch/skills/langwatch/SKILL.md        (the portable skill)
#   plugins/langwatch/build.mjs                        (bundles the hook script into scripts/)
#   sdks/typescript/src/cli/plugin/session-context-entry.ts (what the bundle runs)
#
# Related specs:
#   specs/ai-governance/cli-wrappers/session-context-hook.feature , what the hook reports
#   specs/coding-agent/session-git-context.feature , what the pipeline does with the event
#
# Motivation: `langwatch ingest install claude_code` wires the session context
# hook into the user's own settings file, which works but binds the hook to
# whatever globally installed CLI happens to be on PATH that day. A plugin is
# the distribution the two ecosystems already agree on, so the same directory is
# published once and installed either way:
#
#   - Claude Code reads `.claude-plugin/plugin.json` and the hooks beside it, so
#     a session gets the git context capture with nothing on PATH.
#   - Any Agent Plugins 1.0 client reads the root `plugin.json` and the skills
#     directory. That manifest's schema is CLOSED (ten permitted keys, no
#     component configuration at all), so components are found by fixed
#     location, never declared.
#
# The hook script is not the globally installed CLI. It is a zero-dependency
# single file bundled from the SDK and shipped inside the plugin, so a session's
# capture cannot break because the user upgraded, downgraded or uninstalled the
# CLI. It keeps every constraint the CLI command has: nothing on stdout, always
# exit zero, never the reason a session broke.
#
# It also declines work that is not its own. Agent Plugins clients other than
# Claude Code discover the `.claude-plugin` directory too, and a Codex session
# firing the Claude Code hook would file its work under the wrong agent, so the
# hook checks it is running inside Claude Code before it reads anything at all.

Feature: LangWatch agent plugin package

Rule: One directory is a valid package in both worlds

  @unit
  Scenario: The three manifests agree on the plugin name and version
    Given the plugin directory
    When its portable manifest, its Claude Code manifest and its package manifest are read
    Then all three name the plugin "langwatch"
    And all three report the same version

  @unit
  Scenario: The portable manifest carries only keys the Agent Plugins schema allows
    Given the plugin's portable manifest
    When it is checked against the Agent Plugins 1.0 closed schema
    Then every key it carries is one the schema permits
    And it declares the schema it targets and the plugin name

  @unit
  Scenario: The marketplace offers the plugin from the repository root
    Given the plugin's marketplace manifest
    When a user adds the marketplace
    Then it offers exactly one plugin named "langwatch"
    And that plugin is the directory the marketplace itself lives in

Rule: Installing the plugin is what wires the session hooks

  @unit
  Scenario: The hooks run the bundled script at the start and the end of a session
    Given the plugin's hook configuration
    When Claude Code loads it
    Then it declares exactly the SessionStart and Stop events
    And each runs the session context script that ships inside the plugin
    And each is bounded by a timeout

  @integration
  Scenario: A session in a git repository reports its context once
    Given a signed-in CLI whose config carries an ingest key for Claude Code
    And a session working in a git repository with an origin remote
    When Claude Code starts the session and the plugin's hook runs
    Then exactly one session context record reaches the control plane
    And the session's stdout is left empty and the hook exits zero

  @integration
  Scenario: A session on a machine that never signed in reports nothing
    Given a machine with no LangWatch CLI config
    And a session working in a git repository
    When the plugin's hook runs
    Then nothing is sent
    And the session's stdout is left empty and the hook exits zero

  @integration
  Scenario: A session outside a git repository reports nothing
    Given a signed-in CLI whose config carries an ingest key for Claude Code
    And a session working in a directory that is not a git repository
    When the plugin's hook runs
    Then nothing is sent
    And the session's stdout is left empty and the hook exits zero

  @integration
  Scenario: An agent that is not Claude Code is never reported as Claude Code
    Given a signed-in CLI whose config carries an ingest key for Claude Code
    And another Agent Plugins client that discovered the plugin's Claude Code hooks
    When it runs the hook from a session of its own
    Then nothing is sent
    And the session's stdout is left empty and the hook exits zero
