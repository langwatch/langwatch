Feature: Prompt spans — unsaved/applied prompt version (draft) carries the base reference plus a draft flag
  As a user who started from a saved prompt then edited messages/variables/model inline without saving
  I want the trace to flag the execution as a draft over the original saved prompt
  So that the trace drawer still offers to resume the base prompt
    AND I know the executed config has diverged from what's currently saved at that version

  # The "applied but unsaved" case is what happens on every surface where a user can
  # edit a prompt inline before executing without persisting it as a new version:
  #   - Playground: edit prompt body / messages / variables, send chat
  #   - Studio: open a prompt in a signature node, tweak inline, run workflow
  #   - Evaluations v3: TargetCell.tsx:194 — localPromptConfig overrides saved outputs
  #
  # Wire-format decision (locked with @ash on the channel):
  #   - Keep id / handle / version.id / version.number set to the BASE the user started from
  #     (so trace UI can navigate "Open <handle>:<base_version>" as the resume target)
  #   - Add langwatch.prompt.draft = true on Prompt.compile to flag that the executed config
  #     diverges from the saved version
  #   - The trace's actual LLM-input messages are the source of truth for "what ran"; the
  #     playground reload can prefer those over saved-version-reload when draft=true
  #   - No new "selected vs computed" pipe — we deliberately leave python-sdk's
  #     LangWatchPromptSelectedId unused for now to avoid pre-designing a second channel
  #
  # Bindings:
  #   - Emission scenarios (1, 2, 3, 5, 6, 7): services/nlpgo/tests/integration/prompt_spans_unsaved_version_test.go
  #   - Drawer "unsaved edits" label (4): langwatch/src/features/traces-v2/.../PromptAccordion.integration.test.ts

  Background:
    Given the nlpgo service is running and the project is on the Go-NLP execution path
    And a saved prompt exists with config id "prompt_supportrouter_xyz", handle "support-router", and saved version 6 (version id "prompt_version_supportrouter_v6")

  # Identity contract (see prompt-spans-playground.feature for the locked
  # wire-format reference). draft=true is stamped on Prompt.compile ALONGSIDE
  # the unchanged base identity (raw configId on compile.langwatch.prompt.id,
  # combined "handle:version" on get.langwatch.prompt.id, handle + version.id +
  # version.number separately on compile).

  # ============================================================================
  # Base reference preserved + draft=true on every surface
  # ============================================================================

  @integration @v1
  Scenario: playground draft — user edits a message inline then sends
    Given I have opened "support-router" at version 6 in the playground
    And I edited the system message inline without clicking Save
    When I send "test" through the playground chat
    Then the trace contains a "PromptApiService.get" span with attribute "langwatch.prompt.id" equal to "support-router:6"
    And the trace contains a "Prompt.compile" span with attribute "langwatch.prompt.id" equal to "prompt_supportrouter_xyz"
    And the compile span has attribute "langwatch.prompt.handle" equal to "support-router"
    And the compile span has attribute "langwatch.prompt.version.id" equal to "prompt_version_supportrouter_v6"
    And the compile span has attribute "langwatch.prompt.version.number" equal to 6
    And the compile span has attribute "langwatch.prompt.draft" equal to true

  @integration @v1
  Scenario: eval-v3 draft — TargetCell localPromptConfig overrides saved outputs
    Given the experiment "support-quality-q1" targets "support-router" at version 6
    And the user applied an inline edit via TargetCell.tsx without saving (localPromptConfig set)
    When the experiment runs
    Then every row's compile span has "langwatch.prompt.id" = "prompt_supportrouter_xyz" (raw configId, base reference preserved)
    And every row's compile span has "langwatch.prompt.handle" = "support-router"
    And every row's compile span has "langwatch.prompt.version.number" = 6
    And every row's compile span has "langwatch.prompt.draft" = true
    And the saved prompt at version 6 in the database remains unchanged

  @integration @v1
  Scenario: Studio signature-node draft — inline tweak before running workflow
    Given a workflow has a signature node bound to "support-router" version 6
    And the user opened the signature drawer and changed the temperature without saving back
    When the workflow runs
    Then that node's Prompt.compile span has "langwatch.prompt.id" = "prompt_supportrouter_xyz" (raw configId)
    And that node's Prompt.compile span has "langwatch.prompt.handle" = "support-router"
    And that node's Prompt.compile span has "langwatch.prompt.version.number" = 6
    And that node's Prompt.compile span has "langwatch.prompt.draft" = true
    And the saved prompt at version 6 in the database remains unchanged

  # ============================================================================
  # Trace-UI consumption — draft flag drives "Open with unsaved edits" label
  # ============================================================================

  @integration @v1
  Scenario: trace drawer surfaces the draft state on the "Open in Prompts" affordance
    Given a draft execution has produced a Prompt.compile span with "langwatch.prompt.draft" = true
    When I open the trace details drawer for the resulting LLM span
    Then the prompt panel renders an "unsaved edits" indicator alongside the version chip
    And the "Open prompt" button still resolves to the base reference (handle "support-router", version 6)
    And the Variables panel is pre-filled with the variables captured on the compile span
    # The TS-side reload preference ("prefer trace messages over saved-version messages when draft=true")
    # is owned by a follow-up trace-UI spec, not by nlpgo. Only the draft=true emission contract lives here.

  # ============================================================================
  # Boundary cases — when draft=false should be omitted, not set false
  # ============================================================================

  @integration @v1
  Scenario: saved-version execution does NOT emit a draft attribute (omission, not false)
    Given the playground is using "support-router" version 6 with no inline edits
    When I send a chat message
    Then the compile span has NO "langwatch.prompt.draft" attribute
    # Rationale: matches python-sdk convention of _set_attribute_if_not_none.
    # UI consumers treat absent == false; explicit false would just be noise.

  @integration @v1
  Scenario: fresh ad-hoc prompt is NOT a draft (it has no base to be a draft OF)
    Given no saved prompt was opened in the playground
    When I send a chat message
    Then the compile span has NO "langwatch.prompt.draft" attribute
    And the compile span has NO id / handle / version.* attributes
    # The "Create new prompt" affordance is the only resume path; not a draft.

  # ============================================================================
  # Sanity — diverged messages flow through to the LLM span, not just to compile vars
  # ============================================================================

  @integration @v1
  Scenario: the LLM span's actual input messages are the diverged set, not the saved set
    Given the user edited the system message inline from "be helpful" to "be terse"
    When the chat executes
    Then the LLM span's "input" attribute (the messages array actually sent to the model) contains "be terse"
    And the LLM span's input does NOT contain "be helpful"
    # This is what the playground-on-draft-resume reads to reconstruct the diverged state.
