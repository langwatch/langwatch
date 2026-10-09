# The LangWatch agent plugin: one directory, installable by two worlds
#
# Implementation:
#   plugins/langwatch/plugin.json                              (the portable Agent Plugins 1.0 manifest)
#   plugins/langwatch/.claude-plugin/plugin.json               (the Claude Code manifest)
#   plugins/langwatch/.claude-plugin/marketplace.json          (the marketplace that offers it)
#   plugins/langwatch/hooks/hooks.json                         (the Claude Code session hooks)
#   plugins/langwatch/scripts/launch.mjs                       (the launcher the hooks run)
#   plugins/langwatch/skills/langwatch/SKILL.md                (the portable skill)
#   sdks/typescript/src/cli/commands/ingestion/hook.ts         (what the launcher runs for session context)
#   sdks/typescript/src/cli/program.ts                         (the ingest hook and ingest guidance commands)
#   sdks/typescript/src/cli/utils/governance/cli-location.ts   (where the CLI records how to run it)
#
# Related specs:
#   specs/ai-governance/cli-wrappers/session-context-hook.feature , what the hook reports
#   specs/ai-governance/cli-wrappers/session-context-declare.feature , the guidance the plugin injects
#   specs/coding-agent/session-git-context.feature , what the pipeline does with the event
#
# Motivation: `langwatch ingest install claude_code` wires the session context
# hook into the user's own settings file, which works but shows up as an
# unexplained command in every session. A plugin is the distribution the two
# ecosystems already agree on, so the same directory is published once and
# installed either way:
#
#   - Claude Code reads `.claude-plugin/plugin.json` and the hooks beside it.
#   - Any Agent Plugins 1.0 client reads the root `plugin.json` and the skills
#     directory. That manifest's schema is CLOSED (ten permitted keys, no
#     component configuration at all), so components are found by fixed
#     location, never declared.
#
# The plugin carries no hook logic. Its hooks run one committed launcher, and
# the launcher runs the installed `langwatch` CLI: `ingest hook claude-code`
# for session context, `ingest guidance claude-code` for the guidance. The
# session context the plugin reports needs a CLI login, its skill calls the CLI,
# and `langwatch claude` is what installs it, so the CLI is already a
# requirement. Guidance is the part that still runs without a login, and a
# machine with no CLI at all gets one installation message per session.
# Running it is what makes a hook fix reach plugin users with the next CLI
# release instead of waiting for someone to cut a plugin release.
#
# The launcher finds the CLI in two places, in order: the node binary and entry
# script the CLI recorded about itself at login, `langwatch claude` or
# `langwatch instrument` (a Claude Code started from a desktop app has a PATH
# with no version manager on it), then `langwatch` on PATH. A recorded path
# that no longer exists is skipped. With no CLI anywhere the launcher exits
# zero and, once per session, tells the session the CLI is not installed.
#
# The cross-version contract is what the design rests on: the two hook
# commands accept and ignore arguments they do not know and always exit zero,
# so a plugin from any version runs with a CLI from any version. The launcher
# itself exits zero whatever the CLI did, so a hook is never why a session
# broke.
#
# It also declines work that is not its own. Agent Plugins clients other than
# Claude Code discover the `.claude-plugin` directory too, and a Codex session
# firing the Claude Code hook would file its work under the wrong agent, so the
# launcher checks it is running inside Claude Code before it runs anything.

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

Rule: The hooks run the installed CLI through a committed launcher

  @unit
  Scenario: The hooks run the launcher at the start and the end of a session
    Given the plugin's hook configuration
    When Claude Code loads it
    Then it declares exactly the SessionStart and Stop events
    And each runs the launcher that ships inside the plugin, naming the hook event
    And the guidance runs on SessionStart only
    And each is bounded by a timeout

  @unit
  Scenario: The launcher runs the CLI at its recorded location before the one on PATH
    Given a CLI config recording a node binary and an entry script that exist
    And a different langwatch on PATH
    When the launcher runs the session context hook
    Then it runs the recorded entry script under the recorded node binary
    And hands it the session context command and the hook's stdin

  @unit
  Scenario: The launcher falls through to PATH when the recorded location is stale
    Given a CLI config recording an entry script that no longer exists
    And a langwatch on PATH
    When the launcher runs the session context hook
    Then it runs the langwatch on PATH

  @unit
  Scenario: The launcher skips a PATH entry whose langwatch cannot be run
    Given a PATH entry holding a langwatch that is a directory or has no execute bit
    And a real langwatch further down PATH
    When the launcher runs the session context hook
    Then it runs the langwatch further down PATH

  @unit
  Scenario: The launcher maps the guidance hook to the guidance command
    Given a langwatch on PATH
    When the launcher runs the session guidance hook
    Then it runs the CLI's guidance command for Claude Code
    And what the CLI writes to stdout reaches the session

  @unit
  Scenario: The launcher exits zero whatever the CLI did
    Given a langwatch that exits non-zero
    When the launcher runs a hook
    Then the launcher exits zero

  @unit
  Scenario: The launcher runs nothing for a hook it does not know
    Given a langwatch on PATH
    When the launcher is run with a hook name from another version
    Then nothing is run
    And the launcher exits zero

  @integration
  Scenario: A session in a git repository reports its context once
    Given a signed-in CLI whose config carries an ingest key for Claude Code
    And a session working in a git repository with an origin remote
    When Claude Code starts the session and the plugin's hook runs
    Then exactly one session context record reaches the control plane
    And the session's stdout is left empty and the hook exits zero

  @integration
  Scenario: The plugin's guidance hook emits the guidance as session context
    Given an installed CLI
    When Claude Code starts a session and the plugin's guidance hook runs
    Then stdout is one JSON object whose additionalContext carries the guidance
    And the exit code is zero

  @integration
  Scenario: A session on a machine with no CLI is told once how to install it
    Given a machine with no recorded CLI location and no langwatch on PATH
    When Claude Code starts a session and the plugin's hook runs
    Then stdout is one JSON object whose additionalContext says the CLI is not installed and how to install it
    And the hook exits zero
    And the next hook of the same session says nothing

  @integration
  Scenario: A session on a machine that never signed in reports nothing
    Given a machine with a langwatch on PATH and no LangWatch CLI config
    And a session working in a git repository
    When the plugin's hook runs
    Then nothing is sent
    And the session's stdout is left empty and the hook exits zero

  @integration
  Scenario: An agent that is not Claude Code is never reported as Claude Code
    Given a signed-in CLI whose config carries an ingest key for Claude Code
    And another Agent Plugins client that discovered the plugin's Claude Code hooks
    When it runs the hook from a session of its own
    Then nothing is run and nothing is sent
    And the session's stdout is left empty and the hook exits zero

Rule: A plugin from any version runs with a CLI from any version

  @unit
  Scenario: The session context hook command accepts and ignores arguments it does not know
    Given the CLI's command tree
    When the session context hook command is run with options and arguments it does not know
    Then it runs the hook for the named agent
    And it writes nothing to stdout and does not exit non-zero

  @unit
  Scenario: The guidance command accepts and ignores arguments it does not know
    Given the CLI's command tree
    When the guidance command is run with options and arguments it does not know
    Then it writes the guidance JSON and does not exit non-zero

  @unit
  Scenario: The CLI records where it runs from
    Given a CLI running under a node binary from an entry script
    When it records its location
    Then the config carries the absolute path of that node binary and that entry script
    And recording the same location again writes nothing
    And an entry script that does not exist is not recorded
