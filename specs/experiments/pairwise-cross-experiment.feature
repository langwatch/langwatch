Feature: Pairwise compare — cross-experiment comparison
  # Issue: #5102
  # Parent epic: #5099
  # Depends on: #5100 (pairwise-compare-mvp.feature), #5101 (pairwise-nway-select-best.feature)
  #
  # Extends the pairwise + N-way evaluator with the ability to pull
  # candidate outputs from a SECONDARY experiment run, paired by
  # datasetEntryId. Unblocks "did v1.2 regress vs v1.1?" workflows
  # without manually copying outputs between experiments.
  #
  # Schema delta on EvaluatorConfig.pairwise (Option B, unified):
  #
  #   candidates: Array<{ targetId: string; fromExperimentId?: string }>
  #
  # `fromExperimentId` omitted = the current experiment. The legacy
  # `variants: string[]` from #5101 (and `variantA` / `variantB` from
  # #5100) are kept @deprecated and read-only — `normalizePairwiseConfig`
  # hydrates `candidates[]` from them so existing saved configs keep
  # working without migration.

  Background:
    Given a dataset "qa-regression-v3" with rows keyed by datasetEntryId
    And an experiment "candidate-v1.2" in the current project that ran on "qa-regression-v3" and produced terminal outputs for targets "v1_2_prompt" and "v1_2_alt"
    And an experiment "baseline-v1.1" in the current project that ran on "qa-regression-v3" and produced terminal outputs for targets "v1_1_prompt"
    And the current workbench is editing "candidate-v1.2"

  # ─── Configuration UI ──────────────────────────────────────────────

  Scenario: Configure cross-experiment pairwise
    When I add an evaluator of type "langevals/pairwise_compare"
    And I add candidate #1 with target "v1_2_prompt" from "This experiment"
    And I add candidate #2 with target "v1_1_prompt" from experiment "baseline-v1.1"
    And I select dataset field "expected_output" as Golden
    Then the saved evaluator config has candidates [
      { targetId: "v1_2_prompt", fromExperimentId: <currentExpId or omitted> },
      { targetId: "v1_1_prompt", fromExperimentId: <baselineExpId> }
    ]
    And the saved config has mode "pairwise"

  Scenario: Configure cross-experiment select_best with mixed sources
    When I toggle the mode to "Pick best of N"
    And I add candidate #1 with target "v1_2_prompt" from "This experiment"
    And I add candidate #2 with target "v1_2_alt" from "This experiment"
    And I add candidate #3 with target "v1_1_prompt" from experiment "baseline-v1.1"
    And I select dataset field "expected_output" as Golden
    Then the saved config has mode "select_best" and 3 candidates
    And exactly one candidate has fromExperimentId set to the baseline experiment

  Scenario: Same target id from two different experiments stays distinct
    Given both experiments expose a target whose id is "shared_prompt"
    When I add candidate #1 with target "shared_prompt" from "This experiment"
    And I add candidate #2 with target "shared_prompt" from experiment "baseline-v1.1"
    Then the two candidates are treated as distinct entries
    And the verdict label disambiguates them (e.g. "shared_prompt (this run)" vs "shared_prompt (baseline-v1.1)")

  # ─── Validation at config time ─────────────────────────────────────

  Scenario: Picker rejects an experiment with a different dataset
    Given an experiment "old-dataset-baseline" that ran on dataset "qa-regression-v2"
    When I try to add a candidate from "old-dataset-baseline"
    Then the picker shows an inline error: "Different dataset. baseline uses qa-regression-v2; this experiment uses qa-regression-v3."
    And the candidate cannot be added

  Scenario: Picker only lists experiments the current user can access
    Given an experiment "cross-project-baseline" in a project the user does NOT have access to
    When I open the CrossExperimentPicker
    Then "cross-project-baseline" is NOT in the autocomplete options

  # ─── Run-time guards ───────────────────────────────────────────────

  Scenario: Block the run if the secondary experiment is still running
    Given an evaluator with a candidate referencing experiment "baseline-v1.1"
    And the latest run of "baseline-v1.1" is in state "running"
    When I trigger the evaluation run
    Then the orchestrator returns an error: "Cross-experiment comparison requires baseline-v1.1's latest run to be in a terminal state (current: running)."
    And no judge calls are issued

  Scenario: Block the run if the user no longer has access to the secondary
    Given an evaluator with a candidate referencing experiment "baseline-v1.1"
    And the user's project membership has been revoked from the project owning "baseline-v1.1"
    When I trigger the evaluation run
    Then the orchestrator returns an error: "You do not have access to experiment baseline-v1.1."
    And the error is NOT a silent 404

  Scenario: Block the run if the secondary's dataset id has diverged
    Given a saved evaluator config was created when both experiments shared dataset "qa-regression-v3"
    And "baseline-v1.1" has since been re-run against a different dataset
    When I trigger the evaluation run
    Then the orchestrator returns an error referencing both datasetIds

  # ─── Phase 2 cell generation ───────────────────────────────────────

  Scenario: Generate one cell per row where every candidate has an output
    Given 120 rows in "qa-regression-v3"
    And "candidate-v1.2" produced outputs for "v1_2_prompt" on all 120 rows
    And "baseline-v1.1" produced outputs for "v1_1_prompt" on 87 rows (33 missing)
    When the orchestrator generates Phase 2 pairwise cells
    Then exactly 87 cells are emitted
    And cells are paired by datasetEntryId, not by row index
    And no cell is emitted for the 33 rows missing in baseline

  Scenario: Partial-coverage banner surfaces the skipped count
    Given the previous scenario's run completes
    When I view the evaluator results above the table
    Then a banner reads: "Compared 87 of 120 rows. 33 rows skipped (missing in baseline-v1.1)."

  Scenario: Candidate id is prefixed with experiment id when crossExperiment is set
    Given a Phase 2 cell for a cross-experiment comparison
    When buildEvaluatorInputs assembles the candidates list
    Then each candidate's id is "<experimentId>::<targetId>" so the Python evaluator can disambiguate
    And the same id is what the verdict label resolves back to

  # ─── Results UI ────────────────────────────────────────────────────

  Scenario: Aggregate header shows experiment provenance per variant
    Given the cross-experiment run completes with 50 wins for "v1_2_prompt" and 32 wins for "v1_1_prompt"
    When I view the aggregate header
    Then I see "v1_2_prompt (this run) wins 50 · v1_1_prompt (from baseline-v1.1) wins 32 · Ties 5"

  Scenario: Snapshot label tells the user which run the verdicts were computed against
    Given the cross-experiment run completes
    When I view the evaluator results
    Then a snapshot label reads: "Based on baseline-v1.1 run on 2026-06-20 (3 hours ago)"
    And the label is pinned to the specific experimentRunId used at comparison time

  Scenario: Tombstone — secondary experiment deleted after verdict was stored
    Given a stored verdict references experiment "baseline-v1.1"
    And "baseline-v1.1" has since been deleted
    When I view the verdict
    Then the variant label reads: "v1_1_prompt (from deleted experiment)"
    And the stored verdict data is still visible
    And clicking the snapshot link surfaces a "this comparison source has been deleted" tooltip

  # ─── Back-compat ───────────────────────────────────────────────────

  Scenario: Single-experiment pairwise is unaffected
    When I configure a pairwise evaluator with both candidates from "This experiment"
    Then no secondary experiment is loaded
    And the Phase 2 cell generation path matches #5100 + #5101 behavior exactly
    And the existing single-experiment pairwise tests pass without modification

  Scenario: Legacy variants[] config hydrates into candidates[]
    Given a saved evaluator config stored with { variants: ["v1_2_prompt", "v1_2_alt"] } and no `candidates` field
    When normalizePairwiseConfig runs over it
    Then it returns candidates: [
      { targetId: "v1_2_prompt" },
      { targetId: "v1_2_alt" }
    ]
    And no fromExperimentId is set on either candidate (defaults to current experiment)

  Scenario: Legacy variantA/variantB config hydrates into candidates[]
    Given a saved evaluator config stored with { variantA: "a", variantB: "b" } and neither `variants` nor `candidates`
    When normalizePairwiseConfig runs over it
    Then it returns candidates: [{ targetId: "a" }, { targetId: "b" }] and mode: "pairwise"
