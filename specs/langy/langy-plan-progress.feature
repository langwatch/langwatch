Feature: Langy shows a live plan checklist for multi-step work
  As someone who asked Langy to do something that takes several steps,
  I want to watch a checklist of what it is going to do and where it is,
  so that a long turn reads as deliberate progress rather than an opaque wait.

  # The plan is not narrated in prose and it is not scraped from the model's
  # text. Langy's agent keeps a todo list with the `todowrite` tool; the panel
  # MIRRORS that list as a checklist. The list is the plan — the source of
  # truth is a tool the model already maintains, structurally, not a magic-word
  # convention in prose (the same class of protocol this codebase deliberately
  # killed). Step activity is attributed by stream order: a tool call belongs to
  # whichever plan item was the single in-progress one when the call started.
  #
  # Two increments back this behaviour. In Phase 1 the checklist is folded on
  # the client from the durable `todowrite` tool parts already on the message,
  # so it needs no backend change and survives a reload for free. In Phase 2 the
  # manager authors a typed `plan` snapshot frame (capped and truncated) that the
  # client prefers when present, and the transitions the manager truly knows —
  # a cold spawn, resuming from a handoff — surface as honest status lines.

  @unit
  Scenario: Multi-step work shows a live checklist
    Given Langy is working through a task it planned with three or more steps
    When it maintains its todo list as each step begins
    Then the user sees a checklist of the steps in order
    And exactly one step is shown as the current step
    And earlier steps that finished are shown as done

  @unit
  Scenario: The current step nests the work happening under it
    Given a plan whose second step is the one in progress
    When Langy runs a tool while that step is current
    Then the tool's activity card appears nested under the current step
    And a tool that ran before any step was current is not attributed to a later step

  @unit
  Scenario: Completed steps collapse to a single line
    Given a plan with steps that have finished
    Then each finished step shows as one collapsed line with a done mark
    And a finished step can be re-expanded to see the work that happened under it

  @unit
  Scenario: The checklist survives a reload
    Given a turn that maintained a plan and then finished
    When the user reloads the conversation from history
    Then the checklist still renders from the durable record
    And the current-step activity that was ephemeral is gone

  @unit
  Scenario: A failure freezes the checklist honestly
    Given a plan whose third step was in progress when the turn failed
    Then the finished steps stay marked done
    And the plan is not shown as if it had completed
    And no step is invented that the agent never planned

  @unit
  Scenario: A cancelled step is struck through, not dropped
    Given a plan in which the agent cancelled one of its steps
    Then that step is shown struck through
    And it is not counted toward the completed total

  @unit
  Scenario: No plan means today's rendering, unchanged
    Given a turn in which the agent never maintained a todo list
    Then the message renders exactly as it does today
    And no empty checklist is shown

  @unit
  Scenario: The latest full list wins
    Given the agent rewrote its whole todo list several times in one turn
    When the checklist is folded from the message
    Then it reflects the most recent full list, not an earlier one

  @unit
  Scenario: The manager caps a runaway plan
    Given the agent wrote a todo list with far more items than a checklist should show
    When the manager derives the typed plan snapshot
    Then the number of items is capped and long item text is truncated rather than dropped
    And the durable tool call is still recorded for the audit trail

  @unit
  Scenario: A capability's sub-status shows while a step runs
    Given the current step runs a LangWatch capability
    When that capability starts
    Then a present-continuous sub-status like "Searching traces" shows for the step
    And it is cleared once the step produces output
