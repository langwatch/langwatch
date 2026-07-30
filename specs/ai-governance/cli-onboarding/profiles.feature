Feature: CLI profiles — several identities on one machine
  As a developer running more than one agent, or working across more than one
  account
  I want named credential profiles, and a way to start fresh without touching
  the ones I have
  So that two Claude Code sessions in two directories can be two different
  accounts, and neither can clobber the other.

  Modelled on the AWS CLI, because that is the shape people already know:
  a named profile, a `--profile` flag, an environment variable, and a default.

  The whole system is one function. `configPath()` already decides where
  credentials live, so making it profile-aware gives every existing command
  profiles for free — no command needs to learn anything.

  Pairs with:
    - specs/ai-governance/cli-onboarding/login-unified.feature
    - specs/ai-governance/agent-onboarding/cli-zero-auth-onboarding.feature

  # ─────────────────────────────────────────────────────────────────────
  # Resolution
  # ─────────────────────────────────────────────────────────────────────

  @bdd @cli @profiles @unit
  Scenario: with nothing set, the default profile is the file that always existed
    Given no `--profile` flag and no `LANGWATCH_PROFILE`
    When the CLI resolves where credentials live
    Then it uses `~/.langwatch/config.json`
    # not `profiles/default.json`: an existing install must keep working
    # without a migration step, and its credentials must not appear to vanish.

  @bdd @cli @profiles @unit
  Scenario: a named profile lives beside the default, not inside it
    Given the profile is `work`
    When the CLI resolves where credentials live
    Then it uses `~/.langwatch/profiles/work.json`

  @bdd @cli @profiles @unit
  Scenario Outline: the flag beats the environment beats the default
    Given `<flag>` as the flag and `<env>` in the environment
    Then the resolved profile is `<resolved>`

    Examples:
      | flag | env  | resolved |
      | work | home | work     |
      |      | home | home     |
      |      |      | default  |

  @bdd @cli @profiles @unit
  Scenario: an explicit config path still wins over everything
    Given `LANGWATCH_CLI_CONFIG` points at a file
    And a profile is also named
    Then the explicit path is used
    # tests and non-default homes set it, and a profile silently redirecting
    # them somewhere else would be a very confusing failure.

  @bdd @cli @profiles @security @unit
  Scenario Outline: a profile name that could escape the profiles directory is refused
    When the profile name is `<name>`
    Then the CLI refuses it
    # the name lands in a filesystem path, so anything that can traverse or
    # rewrite that path is rejected rather than sanitised into something the
    # user did not ask for.

    Examples:
      | name        |
      | ../escape   |
      | a/b         |
      | .           |
      |             |

  # @unimplemented: inherited from saveConfig; needs a filesystem test that writes a real profile
  @bdd @cli @profiles @unit @unimplemented
  Scenario: profile files get the same permissions as the default one
    When a profile is written
    Then the file is mode 0600 and its directory is 0700
    # they hold the same credentials; a profile must not be the lax path.

  # ─────────────────────────────────────────────────────────────────────
  # Solo
  # ─────────────────────────────────────────────────────────────────────

  # @unimplemented: lives in the program pre-action hook; needs a command-level test
  @bdd @cli @profiles @solo @unit @unimplemented
  Scenario: `--solo` ignores whatever identity is already on the machine
    Given the default profile holds a live device session
    When the user runs a command with `--solo`
    Then that session is not read
    And the command behaves as though nobody were signed in

  # @unimplemented: same hook; needs a command-level test
  @bdd @cli @profiles @solo @unit @unimplemented
  Scenario: `--solo` never writes to the identity you already had
    Given the default profile holds a live device session
    When a `--solo` run stores credentials
    Then the default profile is unchanged

  @bdd @cli @profiles @solo @unit
  Scenario: solo is per directory, so re-running reuses the same account
    Given a `--solo` run in a directory has already provisioned an account
    When the user runs `--solo` again in that same directory
    Then the same profile is resolved
    # the alternative — a fresh account per invocation — would burn the
    # provisioning rate limit within minutes and litter the account with
    # abandoned workspaces.

  @bdd @cli @profiles @solo @unit
  Scenario: two directories are two accounts
    Given `--solo` runs in two different directories
    Then they resolve to two different profiles
    # which is the point: two agents, two identities, one machine.

  @bdd @cli @profiles @solo @unit
  Scenario: solo is a profile, not a second mechanism
    Then a solo run resolves to an ordinary named profile
    And `--profile <name>` can name the same thing explicitly
    # one storage model with one set of rules, rather than a parallel
    # code path that has to re-learn permissions, resolution and cleanup.

  # ─────────────────────────────────────────────────────────────────────
  # Managing them
  # ─────────────────────────────────────────────────────────────────────

  # @unimplemented: listProfileNames exists; the command surface does not yet
  @bdd @cli @profiles @unit @unimplemented
  Scenario: listing shows every profile and which one is active
    When the user runs `langwatch profile list`
    Then every profile is listed, including the default
    And the active one is marked

  # @unimplemented: same — the listing command is not built
  @bdd @cli @profiles @unit @unimplemented
  Scenario: listing never prints a credential
    When the user runs `langwatch profile list`
    Then no token, key or secret appears in the output
    # `aws configure list` redacts for the same reason: this output gets
    # pasted into issues and screen-shared.

  # @unimplemented: needs the command surface; the resolver underneath is covered above
  @bdd @cli @profiles @integration @unimplemented
  Scenario: `langwatch profile use <name>` sets the active profile persistently
    When the user selects a profile
    Then later commands in new shells resolve to it
