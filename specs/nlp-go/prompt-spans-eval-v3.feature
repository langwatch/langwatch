Feature: Prompt spans on Evaluations v3 — per-row prompt context for resumable evals
  As a user running an Evaluations v3 experiment over a dataset
  I want each row's evaluation to emit the same PromptApiService.get + Prompt.compile span pair
    that langwatch python-sdk emits for an ad-hoc prompt.get / prompt.compile in user code
  So that I can drill into any row in the experiment results and resume that exact (handle, version, variables)
    in the playground for debugging or follow-up

  # Wire-format reference: identical to playground (see prompt-spans-playground.feature).
  # Eval-v3 surfaces that exercise this path:
  #   langwatch/src/evaluations-v3/components/TargetSection/TargetCell.tsx
  #   langwatch/src/evaluations-v3/utils/promptEditorCallbacks.ts
  # Per-row execution dispatcher:
  #   useEvaluationExecution.ts:124 (origin = "evaluation")
  #
  # Bindings:
  #   - Emission scenarios (1, 2, 4, 5): services/nlpgo/tests/integration/prompt_spans_eval_v3_test.go
  #   - Drill-down resume (3): langwatch/src/evaluations-v3/components/.../TargetCell.integration.test.ts

  Background:
    Given the nlpgo service is running and the project is on the Go-NLP execution path
    And an Evaluations v3 experiment named "support-quality-q1" targets a prompt "support-router" at saved version 6
    And the experiment's dataset has 3 rows with column "input" populated

  # ============================================================================
  # Per-row span emission — one pair per dataset row, scoped to that row's vars
  # ============================================================================

  @integration @v1
  Scenario: each evaluated row emits its own PromptApiService.get + Prompt.compile pair
    When I run the experiment
    Then the run produces exactly 3 spans named "PromptApiService.get" (one per row)
    And the run produces exactly 3 spans named "Prompt.compile" (one per row)
    And every compile span has attribute "langwatch.prompt.id" equal to "support-router:6"
    And every compile span has attribute "langwatch.prompt.handle" equal to "support-router"
    And every compile span has attribute "langwatch.prompt.version.number" equal to 6
    And each compile span has attribute "langwatch.prompt.variables" containing that row's "input" value (not a different row's)
    And all spans carry attribute "langwatch.origin" equal to "evaluation"

  @integration @v1
  Scenario: per-row spans are scoped under their per-row execution root, not the experiment root
    When I run the experiment
    Then each row's PromptApiService.get / Prompt.compile / LLM span trio share a single per-row trace_id
    And no row's prompt spans appear as ancestors or siblings of another row's prompt spans
    # This is what the trace-UI ancestor-walk (findPromptReferenceInAncestors.ts) relies on
    # to avoid cross-row prompt-id leakage when drilling into a single result cell.

  # ============================================================================
  # Drill-down resume — clicking a result cell jumps back to playground at that row
  # ============================================================================

  @integration @v1
  Scenario: clicking a row in experiment results opens the trace drawer with "Open in Prompts"
    Given the experiment has run and row 2 (input = "I want a refund") has a completed result
    When I click the row 2 result cell in the experiment results page
    Then the trace details drawer opens for row 2
    And the drawer's "Open in Prompts" menu offers "Open support-router:6"
    And clicking it opens the playground at "support-router" version 6
    And the playground Variables panel is pre-filled with "input" = "I want a refund"

  # ============================================================================
  # Mixed-target experiment — only prompt-backed targets get the pair
  # ============================================================================

  @integration @v1
  Scenario: a target that is not a saved prompt emits no PromptApiService.get
    Given the experiment also has a free-form code target with no prompt config
    When I run the experiment
    Then no span named "PromptApiService.get" is emitted for the code-target rows
    And the code-target rows still produce LLM spans without prompt attributes

  # ============================================================================
  # Failure propagation — fetch failure on one row doesn't corrupt others
  # ============================================================================

  @integration @v1
  Scenario: a row whose prompt fetch fails records the exception on its own get span
    Given the prompt API returns 500 for row 1 but succeeds for rows 2 and 3
    When I run the experiment
    Then row 1's PromptApiService.get span has a recorded exception event
    And row 1's Prompt.compile span is not emitted (compile never ran)
    And rows 2 and 3 emit the full get + compile + LLM trio normally
    And no cross-row attribute pollution is observed
