Feature: Langy answers "How do I improve my agent's latency?" through a playbook
  As a LangWatch user
  I want Langy to take me from my current project state to evidence-backed
  latency insights
  So that I can improve my agent even when telemetry is missing or wrong

  # The knowledge lives in one place: docs/playbooks/how-do-i/*.mdx. The skill
  # stays thin — it resolves a topic to a playbook slug, loads the playbook
  # (baked copy first, then the docs site), builds a task list from its
  # prerequisites, runs the checks, and follows whichever branch matches. None
  # of the domain knowledge (what "good" latency data looks like, what a
  # repair looks like) is allowed to leak into the skill body — that is what
  # keeps the skill reusable for the next "how do I" question and keeps a
  # branch under test judged against its OWN playbook rather than the
  # published one.
  #
  # The @unit scenarios below pin the build-time contract: the skill ships,
  # carries no latency knowledge, the baked playbook is byte-identical to the
  # docs source, the routing table sends "How do I" questions to this skill
  # ahead of any topic-specific row, and the empty-state chip that starts the
  # flow exists. The @e2e scenarios are the BDD acceptance block from the
  # issue verbatim — they prove the live behavior against a running Langy and
  # are bound by the scenario suite, not by this pass.

  # ---------------------------------------------------------------------------
  # Build-time contract: the skill ships thin, the playbook ships baked,
  # routing sends "How do I" here first, and the chip is offered.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The how-do-i skill ships with Langy
    Given the canonical skills library
    When the native skill set is compiled for Langy
    Then a "how-do-i" skill is present in the compiled native set
    And it is registered in the skill registry

  @unit
  Scenario: The how-do-i skill carries no latency knowledge
    Given the compiled "how-do-i" SKILL.md
    When it is scanned for latency domain vocabulary
    Then it contains none of "p50", "p95", "latency distribution", "slowest operation", "span timing"
    And it references the "improve-agent-latency" playbook by slug

  @unit
  Scenario: The baked playbook is the docs playbook
    Given the docs playbook at "docs/playbooks/how-do-i/improve-agent-latency.mdx"
    When the native skill set is compiled for Langy
    Then the compiled copy under the "how-do-i" skill is byte-identical to the docs source
    And no compiled playbook exists without a matching docs source

  @unit
  Scenario: A question that starts with How do I routes to the how-do-i skill
    Given Langy's AGENTS.md routing table
    When a row's intent cell contains "How do I"
    Then that row names the "how-do-i" skill
    And that row comes before the row that names "latency"

  @unit
  Scenario: The empty state offers the latency question
    Given the Langy empty state's suggested questions
    When the suggestions are listed
    Then one of them has the label and prompt "How do I improve my agent's latency?"
    And it requires nothing from the project
    And picking it pins the "how-do-i" skill on the turn it sends

  # ---------------------------------------------------------------------------
  # Live behavior — the BDD acceptance block from the issue, verbatim. Bound
  # by the scenario suite (platform/app/e2e/langy/*.scenario.test.ts), not by
  # this pass.
  # ---------------------------------------------------------------------------

  @e2e
  Scenario: Telemetry not set up
    Given a project with no traces
    When the user asks how to improve the agent's latency
    Then Langy reports that no traces exist and guides the user to set up tracing
    And Langy does not report any latency numbers
    And the parent goal stays in the task list as not done

  @e2e
  Scenario: Telemetry set up incorrectly
    Given a project whose traces have spans without timing and LLM attributes
    When the user asks how to improve the agent's latency
    Then Langy names the specific missing data and how to repair the instrumentation
    And Langy does not present insights built on the incomplete spans
    And the parent goal stays in the task list as not done

  @e2e
  Scenario: Telemetry correct and spans good enough for insights
    Given a project with traces whose spans carry timing, LLM model and operation attributes
    When the user asks how to improve the agent's latency
    Then Langy reports latency distribution, slowest operations, and cites at least one trace as evidence
    And Langy gives at least one concrete recommendation
    And the task list shows all tasks completed

  @e2e
  Scenario: The parent goal stays open during a prerequisite branch
    Given a project where a prerequisite check fails
    When Langy goes sideways to fix that prerequisite
    Then the parent goal item in the task list stays not done
    And a prerequisite item for the failing check appears in the task list

  @e2e
  # The live page reload is proved by the PR's browser screenshots (AC9). This scenario proves the persisted read the panel performs after a reload.
  Scenario: The plan checklist survives a reload
    Given Langy has written a task list for a conversation
    When the conversation's messages are read back the way the panel does after a reload
    Then the same task list and statuses are shown

  # @unimplemented: the live harness (platform/app/e2e/langy) shares one pod and cannot remove the baked playbook or block egress for a single conversation.
  # How it would be proved is written above the it.skip in platform/app/e2e/langy/langy-how-do-i-latency.scenario.test.ts. Tracked on issue #8184.
  @e2e @unimplemented
  Scenario: The playbook cannot be loaded
    Given the playbook is not available locally or remotely
    When the user asks how to improve the agent's latency
    Then Langy says the playbook could not be loaded and stops
    And Langy does not improvise a procedure

# AC coverage map
# AC1  (docs nav + llms.txt)                              — not covered by this pass; docs-build check, no scenario here
# AC2  (playbook sections in order)                        — not covered by this pass; docs-content check, no scenario here
# AC3  (skill ships, in registry, compiles, drift test)    -> The how-do-i skill ships with Langy
# AC4  (no latency tokens, references playbook by id)      -> The how-do-i skill carries no latency knowledge
# AC5  (baked into image, loads under network-off)         -> The baked playbook is the docs playbook (build-time half); live network-off half is @e2e "The playbook cannot be loaded"
# AC6  ("How do I" routes to the skill; other text doesn't) -> A question that starts with How do I routes to the how-do-i skill
# AC7  (empty-state chip sends exact text + pins how-do-i skill) -> The empty state offers the latency question
# AC8  (todowrite plan: parent goal first, prerequisite items) -> Telemetry correct and spans good enough for insights; The parent goal stays open during a prerequisite branch
# AC9  (plan checklist re-shown after reload)               -> The plan checklist survives a reload
# AC10 (branch keeps parent goal not-done, carries prerequisite item) -> The parent goal stays open during a prerequisite branch
# AC11 (scenario: no traces)                                -> Telemetry not set up
# AC12 (scenario: incorrect telemetry)                      -> Telemetry set up incorrectly
# AC13 (scenario: correct telemetry)                        -> Telemetry correct and spans good enough for insights
# AC14 (seeding lives in the harness, not the product)       -> covered by the scenario suite's seeding helper, not a scenario title here
# AC15 (feature file covers every issue scenario, parity passes) -> this file
# AC16 (playbook cannot be loaded -> stop, no improvisation) -> The playbook cannot be loaded (@unimplemented, deferred: needs an isolated worker image)
# AC17 (regression: skills + Langy component tests pass)     -> covered by running the suites named in this issue's evidence, not a scenario title here
# AC18 (Langy's own traces excluded via --origin application)  -> Telemetry not set up (the scratch project already carries Langy's own conversation traces)
