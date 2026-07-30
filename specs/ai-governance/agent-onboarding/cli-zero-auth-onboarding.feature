Feature: `npx langwatch claude` with no account at all
  As a developer trying LangWatch for the first time, or an agent driving my
  terminal
  I want one command that gets traces flowing without a signup
  So that I see the product working before I decide whether to keep it.

  `langwatch claude` already exists as the gateway wrapper: it routes an
  assistant's LLM calls through the AI Gateway, which needs an org, a virtual
  key and configured providers. Today, with none of those, it stops at
  "Not logged in". That dead end is where this starts instead.

  The zero-auth path is a different, much smaller thing: no gateway, no virtual
  key, no provider setup — only OTLP telemetry pointed at a temporary project.
  That is why it can work with nothing at all, and why it does not replace the
  gateway path for people who have one.

  Pairs with:
    - specs/ai-governance/agent-onboarding/provisioning.feature
    - specs/ai-governance/agent-onboarding/passkey-claim.feature
    - specs/ai-governance/cli-onboarding/profiles.feature

  # ─────────────────────────────────────────────────────────────────────
  # The front door
  # ─────────────────────────────────────────────────────────────────────

  @bdd @cli @onboarding @unit
  Scenario: with no identity, the command provisions instead of refusing
    Given the user has no device session and no project API key
    When they run `npx langwatch claude`
    Then a temporary account is provisioned
    And the run continues rather than exiting with "Not logged in"

  @bdd @cli @onboarding @unit
  Scenario: telemetry is written to the git-ignored settings file
    When a temporary account is provisioned
    Then the OTLP exporter config is written to `.claude/settings.local.json`
    # `.local.json` and not `settings.json`: the file carries an ingestion
    # key, and the local one is the git-ignored half of the pair.

  @bdd @cli @onboarding @unit
  Scenario: re-running updates in place rather than stacking a second block
    Given `langwatch claude` already wired this directory
    When the user runs it again
    Then the existing settings are updated, not duplicated

  @bdd @cli @onboarding @unit
  Scenario: an existing exporter pointing somewhere else is not silently taken over
    Given the settings already export OTLP to another collector
    When the user runs `langwatch claude`
    Then the CLI asks before changing it
    # someone else's telemetry pipeline is not ours to redirect.

  @bdd @cli @onboarding @unit
  Scenario: the credentials land in a profile, not loose on disk
    When a temporary account is provisioned
    Then the ingestion key and claim token are stored in the resolved profile
    And re-running in that directory reuses them

  # ─────────────────────────────────────────────────────────────────────
  # What the developer is told
  # ─────────────────────────────────────────────────────────────────────

  @bdd @cli @onboarding @copy @unit
  Scenario: the deadlines come from the server, not from the CLI
    When the account is provisioned
    Then the printed notice is the copy the server returned
    # a self-hosted install can run different windows, and a CLI that hardcoded
    # "7 days" would confidently print a number its own server does not enforce.

  @bdd @cli @onboarding @unit
  Scenario: the claim URL is printed as a QR code for a phone to scan
    When the account is provisioned
    Then a QR code encoding the claim URL is rendered in the terminal
    And the URL is printed as text as well
    # the text matters: a QR is useless over SSH into a scrollback buffer, in
    # CI logs, or to anyone using a screen reader.

  @bdd @cli @onboarding @unit
  Scenario: the QR is skipped where it cannot work
    Given the terminal is not interactive, or is too narrow for the code
    When the account is provisioned
    Then the URL is printed without the QR
    # a mangled QR is worse than none — it looks scannable and is not.

  # ─────────────────────────────────────────────────────────────────────
  # Agents
  # ─────────────────────────────────────────────────────────────────────

  @bdd @cli @onboarding @agent @unit
  Scenario: an agent-driven run prints no QR and opens no browser
    Given the CLI detects it is being driven by an agent
    When the account is provisioned
    Then no QR is rendered and no browser is launched
    And the claim URL is emitted for the agent to relay to its human
    # an agent cannot scan a QR or see a browser; printing one just fills its
    # context with noise it has to summarise.

  # ─────────────────────────────────────────────────────────────────────
  # Solo
  # ─────────────────────────────────────────────────────────────────────

  # @unimplemented: depends on the persistence above plus the pre-action hook
  @bdd @cli @onboarding @solo @unit @unimplemented
  Scenario: `--solo` provisions a fresh account even when signed in
    Given the user is signed in on the default profile
    When they run `langwatch claude --solo`
    Then a temporary account is provisioned for this directory
    And the signed-in identity is untouched
    # the two-agents-two-accounts case: one terminal per identity, neither
    # able to disturb the other.

  # @unimplemented: needs the wrapper's exec path; provisioning and settings are covered above
  @bdd @cli @onboarding @integration @unimplemented
  Scenario: the wrapped assistant starts with the exporter already exported
    When provisioning completes
    Then `claude` is executed with the OTEL_* environment in place

  # @unimplemented: needs the poll loop wired to the running assistant
  @bdd @cli @onboarding @integration @unimplemented
  Scenario: claiming from the phone is noticed by the waiting CLI
    Given the developer scans the QR and enrols a passkey
    When the CLI next polls
    Then it reports the account as claimed
