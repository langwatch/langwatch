Feature: The gate prices an action before it silently invalidates a prompt cache
  As a developer running around ten agents with large contexts
  I want to be told what a routine action is about to cost before it happens
  So that a one-line edit does not quietly re-bill a whole conversation, and a
  stuck agent does not burn turns unattended

  # Second duty of `haven gate` (specs/claude/agent-admission-gate.feature).
  # Separate concern, same seam: the hook that sees a command before it runs
  # also sees the cache-invalidating ones. See ADR-088.
  #
  # THE BUST CONSTANT, from published rates. Prompt caching is a prefix match:
  # any byte change in the prefix invalidates everything after it. A cache read
  # costs 0.1x base input; a cache write costs 1.25x on the 5-minute TTL, 2x on
  # the hour. So invalidating a prefix you were about to read costs the
  # difference — 1.15x base input per token re-cached, or 1.9x on the hour TTL.
  # On a 300k-token prefix at Opus 5's input rate that is roughly $1.73 or
  # $2.85. Per bust. Per agent. The actions that cause it are small and routine
  # and none of them announce a price.
  #
  # WARN, DO NOT DECIDE. A cache-busting edit is usually deliberate. The gate's
  # job is to make the price visible at the moment of the action, not to prevent
  # it. Exactly two things get a hard deny, because both are unambiguous waste
  # with no legitimate reading: a tool call repeating identically past a
  # threshold, and a sub-agent spawn past the machine-wide cap.
  #
  # CERTAINTY IS RANKED AND STATED. That a model switch or a tool-list change
  # invalidates everything is documented behaviour. That editing an instructions
  # file does depends on where the harness places it in the prefix, which is not
  # verified here. A warning that is wrong twice is a warning nobody reads a
  # third time, so the uncertain ones say what they are.

  # --- Measure before enforcing ---

  # The Claude Code OTel export already carries token metrics split by
  # cache_read and cache_creation, and it already points at LangWatch. The ratio
  # of the two per session decides which of the checks below are worth having:
  # if cache reads dominate, most of this file is theoretical. The dashboard is
  # the first deliverable, not the hook.
  @integration @unimplemented
  Scenario: The cache hit ratio is visible before any warning is built
    Given Claude Code telemetry is exported with token detail
    When I look at a session's token usage
    Then cache-read and cache-creation tokens are reported separately
    And their ratio tells me whether cache invalidation is actually costing anything here

  # --- High certainty: documented invalidators ---

  @unit @unimplemented
  Scenario: Switching model mid-session is priced before it happens
    Given a session with a large cached prefix
    When the model is about to be switched
    Then the gate reports that the entire cache is discarded, tools and system included
    And that there is no escape hatch, because caches are scoped to one model
    And that switching back pays the same price a second time

  @unit @unimplemented
  Scenario: Changing the tool set mid-session is priced before it happens
    Given a session with a large cached prefix
    When an MCP server or plugin is about to be enabled or disabled
    Then the gate reports that this invalidates everything, including the tools cache
    Because tool definitions sit at the very front of the prefix

  @unit @unimplemented
  Scenario: The most expensive action is the one that is easiest to trigger by accident
    When a settings change would alter the tool list
    Then it is warned about with the same weight as a model switch
    Because nothing about toggling a plugin suggests it costs a whole conversation

  # --- The size gate is what keeps the warnings credible ---

  @unit @unimplemented
  Scenario: A small cached prefix produces no warning at all
    Given the session's cached prefix is below the warning threshold
    When a cache-invalidating action is gated
    Then nothing is reported
    Because a warning on a cheap action trains the reader to dismiss the expensive one

  @unit @unimplemented
  Scenario: The warning states the price, not just the fact
    Given the session's cached prefix is large
    When a cache-invalidating action is gated
    Then the report names the size of the prefix being discarded and what re-caching it costs
    And the figure distinguishes the five-minute from the one-hour TTL, because they differ by nearly a factor of two

  @unit @unimplemented
  Scenario: The prefix size is estimated from what the hook already receives
    When the gate needs the size of the cached prefix
    Then it estimates it from the transcript the payload already points at
    And it does not make an API call to find out, because pricing a warning must not cost tokens

  # --- Lower certainty: stated as such ---

  @unit @unimplemented
  Scenario: An edit to an instructions file is flagged with its uncertainty attached
    Given a large cached prefix
    When an instructions or rules file is about to be edited mid-session
    Then the gate reports the possible cost
    And it states that whether this invalidates depends on where the harness places that file
    Until that placement is verified, at which point the hedge is removed

  # --- The silent one ---

  # A breakpoint walks back at most 20 content blocks to find a prior cache
  # entry. An agentic turn with many tool_use/tool_result pairs can exceed that,
  # and the next request silently misses — no error, just a cold read, every
  # turn, continuously. If this is happening it dwarfs every per-event cost in
  # this file. If the harness places its breakpoints correctly it is worth
  # nothing. It is a measurement, not an assumption.
  @integration @unimplemented
  Scenario: A turn that could outrun the lookback window is reported
    Given a turn that produced more content blocks than a breakpoint can walk back over
    When the turn completes
    Then the gate reports that the next request may silently miss its cache
    And the report says how to confirm it from the cache-read token count

  # --- Idle sessions ---

  @unit @unimplemented
  Scenario: A session approaching its cache expiry is visible
    Given a session that has been idle
    When it approaches the prompt-cache floor
    Then the remaining warmth is surfaced
    So the cost of picking the session back up is known before it is paid

  # --- Unambiguous waste is denied, not warned about ---

  @unit @unimplemented
  Scenario: A tool call repeating identically is stopped
    Given the same tool has been called with identical input past the repeat threshold
    When it is called again
    Then it is denied
    And the reason says the call is repeating and asks for a different approach

  @unit @unimplemented
  Scenario: The repeat detector does not fire on legitimate repetition
    Given the same tool called with different input each time
    When it is called again
    Then it is not denied
    Because reading many files with one tool is normal work, not a loop

  @unit @unimplemented
  Scenario: A sub-agent spawned on a heavier model than its work needs is flagged
    Given a policy naming which model tier suits which kind of sub-agent work
    When a sub-agent is spawned outside that policy
    Then the gate reports the tier difference and what it multiplies
    Because a retrieval task on the top tier costs several times what it needs to

  # --- Same discipline as the admission half ---

  @unit @unimplemented
  Scenario: A cost check that cannot run defers silently
    Given the gate cannot read what it needs to price an action
    Then it defers without warning
    Because a governor that cannot measure must not guess, and must never block
