Feature: The gate prices an action before it silently invalidates a prompt cache
  As a developer running around ten agents with large contexts
  I want to be told what a routine action is about to cost before it happens
  So that a one-line edit does not quietly re-bill a whole conversation, and a
  stuck agent does not burn turns unattended

  # Second duty of `haven gate` (specs/claude/agent-admission-gate.feature).
  # Separate concern, same seam. See ADR-088.
  #
  # THE BUST CONSTANT, from published rates. Prompt caching is a prefix match:
  # any byte change in the prefix invalidates everything after it. A cache read
  # costs 0.1x base input; a cache write costs 1.25x on the 5-minute TTL, 2x on
  # the hour. So invalidating a prefix you were about to read costs the
  # difference — 1.15x base input per token re-cached, or 1.9x on the hour TTL.
  # On a 300k-token prefix at Opus 5's input rate that is roughly $1.73 or
  # $2.85. Per bust. Per agent.
  #
  # THE WARNINGS ARE FOR THE DEVELOPER, NOT THE MODEL. There is no primitive
  # that shows the model a price and still lets the action proceed: a system
  # message reaches the developer and not the model, an ask interrupts the
  # developer, and a deny reaches the model but blocks. So each check below
  # names its channel. High-certainty invalidations on a large prefix ask;
  # everything else emits a system message; only unambiguous waste denies.
  #
  # NOT EVERY CHECK CAN LIVE ON PreToolUse. A settings or instructions change
  # can arrive with no tool call at all, and a turn-shaped observation is not
  # visible before a tool runs. Each scenario names the event it observes.
  #
  # CERTAINTY IS RANKED AND STATED. That a model switch or a tool-list change
  # invalidates everything is documented behaviour. That editing an instructions
  # file does depends on where the harness places it in the prefix, which is not
  # verified. Neither is whether `/model` raises a hook at all. A warning that
  # is wrong twice is a warning nobody reads a third time.

  # --- Measure before enforcing ---

  # The repo's .claude/settings.json sets OTEL exporters and an endpoint, and
  # Claude Code splits token metrics by cache_read and cache_creation. But it
  # sets no telemetry-enable flag and no exporter auth, and the user-level
  # settings set no OTEL keys at all, so whether any of it arrives is not
  # confirmed. Confirming that export is the first deliverable, before any
  # warning below is built.
  @integration @unimplemented
  Scenario: Cache-read and cache-creation tokens are reported as separate series
    Given Claude Code telemetry is confirmed to be arriving
    When I look at a session's token usage
    Then cache-read and cache-creation tokens appear as distinct series

  # --- High certainty: documented invalidators ---

  @unit @unimplemented
  Scenario: Changing the tool set mid-session is priced before it happens
    Given a session whose cached prefix is above the warning threshold
    When a settings change that would alter the tool list is observed
    Then the developer is asked to confirm, with the price in the prompt
    And the price says this invalidates everything, including the tools cache
    Because tool definitions sit at the very front of the prefix

  @unit @unimplemented
  Scenario: A tool-set change that arrives without a tool call is still seen
    Given an MCP server is toggled outside the tool surface
    When the configuration change is observed
    Then it is priced the same way
    Because the action that costs the most is the one least likely to look like a command

  @unit @unimplemented
  Scenario: Switching model mid-session is priced, if the switch can be observed
    Given a session whose cached prefix is above the warning threshold
    When a model switch is observed
    Then the developer is told the entire cache is discarded, tools and system included
    And that there is no escape hatch, because caches are scoped to one model
    And that switching back pays the same price again
    # Whether a model switch raises any hook is UNVERIFIED. If it does not, this
    # scenario is unreachable and should be removed rather than left aspirational.

  # --- The size gate is what keeps the warnings credible ---

  @unit @unimplemented
  Scenario: A small cached prefix produces no warning at all
    Given the session's cached prefix is below the warning threshold
    When a cache-invalidating action is observed
    Then nothing is reported
    Because a warning on a cheap action trains the reader to dismiss the expensive one

  @unit @unimplemented
  Scenario: The warning states the price, not just the fact
    Given the session's cached prefix is above the threshold
    When a cache-invalidating action is priced
    Then the report names the approximate size of the prefix and what re-caching it costs
    And it names which cache lifetime the figure assumes
    # The two lifetimes differ by nearly a factor of two, and which one a session
    # is using is not something the gate can read. Quoting a figure without
    # naming its assumption is half a warning.

  @unit @unimplemented
  Scenario: The prefix size is a cheap approximation, and says so
    When the gate needs the size of the cached prefix
    Then it approximates it from the transcript the payload already points at
    And it does not parse the whole transcript, because the fast path budget forbids it
    And it does not make an API call, because pricing a warning must not cost tokens
    And the figure is presented as approximate, because the transcript is not the prefix

  # --- Lower certainty: stated as such ---

  @unit @unimplemented
  Scenario: An edit to an instructions file is flagged with its uncertainty attached
    Given a large cached prefix
    When an instructions or rules file is edited mid-session
    Then the developer is told the possible cost
    And is told that whether this invalidates depends on where the harness places that file
    Until that placement is verified, at which point the hedge is removed

  # --- The silent one ---

  # A breakpoint walks back at most 20 content blocks to find a prior cache
  # entry. A turn with many tool_use/tool_result pairs can exceed that, and the
  # next request silently misses — no error, just a cold read, every turn,
  # continuously. If this is happening it dwarfs every per-event cost in this
  # file. If the harness places its breakpoints correctly it is worth nothing.
  # It is a measurement, not an assumption. Observed at the end of a turn,
  # because that is when the block count is known.
  @integration @unimplemented
  Scenario: A turn that could outrun the lookback window is reported
    Given a turn that produced more content blocks than a breakpoint can walk back over
    When the turn completes
    Then the developer is told the next request may silently miss its cache
    And is told how to confirm it from the cache-read token count

  # --- Fan-out has a cache price as well as a memory price ---

  @unit @unimplemented
  Scenario: Sub-agents launched together are priced for the cache they cannot share
    Given several sub-agents are launched in one turn on a shared prefix
    When the spawn is priced
    Then the report notes each one pays the cache write rather than the read
    Because an entry is readable only once the first response using it begins streaming

  # --- Unambiguous waste is denied, not warned about ---

  @unit @unimplemented
  Scenario: A tool call repeating identically with no intervening change is stopped
    Given the same tool called with identical input, consecutively, past the repeat threshold
    And no file was edited and no other tool was called in between
    When it is called again
    Then it is denied
    And the reason says the call is repeating and asks for a different approach

  @unit @unimplemented
  Scenario: A test rerun after an edit is not a repeat
    Given the same test command run twice with a file edit in between
    When it is called the second time
    Then it is not denied
    Because that is the ordinary red-green loop and denying it would break the main way work gets done

  @unit @unimplemented
  Scenario: An interleaved call resets the repeat count
    Given the same tool called twice with a different tool called in between
    When it is called again
    Then it is not denied

  @unit @unimplemented
  Scenario: The repeat count is scoped to one session and does not outlive it
    Given repeat state recorded for a session
    When that session ends
    Then the state is discarded
    Because a count that leaks across sessions eventually denies a first attempt

  # --- Model tier ---

  @unit @unimplemented
  Scenario: A sub-agent spawned on a heavier model than its work needs is flagged
    Given a policy naming which model tier suits which kind of sub-agent work
    When a sub-agent is spawned outside that policy
    Then the developer is told the tier difference and what it multiplies
    Because a retrieval task on the top tier costs several times what it needs to
    # The policy is configuration, not something the gate invents. It lives with
    # haven's own configuration and is absent by default, in which case this
    # check does nothing at all.

  # --- Same discipline as the admission half ---

  @unit @unimplemented
  Scenario: A cost check that cannot run defers silently
    Given the gate cannot read what it needs to price an action
    Then it defers without warning
    Because a governor that cannot measure must not guess, and must never block
